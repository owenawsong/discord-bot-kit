import { createInterface } from 'node:readline';
import type { Bot } from './types.js';
import { Simulator, input, actors } from './simulate.js';
import { runScenarios } from './scenarios.js';
import { validateSession, type Session } from './server.js';
export function startMcp(bot:Bot) {
  let sim=new Simulator(bot);
  const tools=[
    {name:'inspect_bot',description:'List commands and component routes without executing Discord actions.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'simulate_interaction',description:'Execute the real bot handler locally. Returns replies, effects, diagnostics and durable state. No Discord connection.',inputSchema:{type:'object',properties:{name:{type:'string'},kind:{type:'string',enum:['command','button','modal','select']},actor:{type:'string',enum:['member','stranger','moderator']},args:{type:'object',additionalProperties:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'}]}},fields:{type:'object',additionalProperties:{type:'string'}},values:{type:'array',items:{type:'string'}},ageMs:{type:'number'},dm:{type:'boolean'},channelId:{type:'string'}},required:['name'],additionalProperties:false}},
    {name:'run_recipe_scenarios',description:'Run the selected ticket or signup recipe checks in isolated simulation. Custom bots need their own CLI scenario files.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'reset_simulation',description:'Reset only the local in-memory workshop session.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
  ];
  let queue=Promise.resolve();
  const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
  rl.on('line',line=>{queue=queue.then(async()=> {
    if(Buffer.byteLength(line)>1_000_000)return;
    let req:{jsonrpc?:string;id?:number|string|null;method:string;params?:{name?:string;arguments?:Session}};
    try {req=JSON.parse(line);}catch {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');return;}
    if(!req||typeof req!=='object'||Array.isArray(req)||req.jsonrpc!=='2.0'||typeof req.method!=='string'||(req.id!==undefined&&req.id!==null&&typeof req.id!=='string'&&typeof req.id!=='number')) {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}})+'\n');return;}
    if(req.id===undefined)return;
    try {
      let result:unknown;
      if(req.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'guildwright',version:'0.1.0'}};
      else if(req.method==='ping')result={};
      else if(req.method==='tools/list')result={tools};
      else if(req.method==='tools/call') {
        let value:unknown;
        if(req.params?.name==='inspect_bot')value={name:bot.name,commands:bot.commands.map(({handler,...x})=>x),routes:bot.routes.map(({handler,...x})=>x)};
        else if(req.params?.name==='simulate_interaction'){const b=req.params.arguments;validateSession(b);value=await sim.run(input(b.name!,{kind:b.kind??'command',actor:actors[b.actor??'member'],fields:b.fields,args:b.args,values:b.values,ageMs:b.ageMs,channelId:b.channelId??'lobby',guildId:b.dm?undefined:'workshop-guild'}));}
        else if(req.params?.name==='run_recipe_scenarios'||req.params?.name==='run_ticket_scenarios')value=await runScenarios(bot);
        else if(req.params?.name==='reset_simulation'){sim=new Simulator(bot);value={reset:true};}
        else throw new Error('Unknown tool');
        result={content:[{type:'text',text:JSON.stringify(value)}],isError:false};
      }else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{code:-32601,message:'Method not found'}})+'\n');return;}
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\n');
    }catch(e){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{code:-32602,message:e instanceof Error?e.message:'Invalid request'}})+'\n');}
  }).catch(()=>{});});
}

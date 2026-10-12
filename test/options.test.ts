import test from 'node:test';
import assert from 'node:assert/strict';
import { defineBot } from '../src/core.js';
import { validateArguments,validateOptionSchema } from '../src/options.js';
import { Simulator,input } from '../src/simulate.js';
import { commandManifest,readConfig } from '../src/discord.js';
import type { CommandOption } from '../src/types.js';
const options:CommandOption[]=[
  {name:'text',description:'Text',type:'string',required:true,minLength:2,maxLength:5},
  {name:'count',description:'Count',type:'integer',required:true,min:1,max:3},
  {name:'ratio',description:'Ratio',type:'number',min:0,max:1},
  {name:'enabled',description:'Enabled',type:'boolean'},
  {name:'person',description:'Person',type:'user'},
  {name:'room',description:'Room',type:'channel'},
  {name:'mode',description:'Mode',type:'string',choices:[{name:'Quiet',value:'quiet'},{name:'Loud',value:'loud'}]}
];
const fixture=()=>defineBot({name:'Arguments',commands:[{name:'options',description:'Argument fixture',options,handler:async c=>{await c.reply({content:JSON.stringify(c.args)});}}],routes:[]});
test('all supported argument types retain their actual values',async()=>{const args={text:'Hello',count:2,ratio:.4,enabled:false,person:'123456789012345678',room:'123456789012345679',mode:'quiet'};const r=await new Simulator(fixture()).run(input('options',{args}));assert.equal(r.diagnostics.length,0);assert.deepEqual(JSON.parse((r.events[0].data as any).content),args);});
test('missing required options fail before side effects',async()=>{const r=await new Simulator(fixture()).run(input('options',{args:{text:'Hello'}}));assert.equal(r.diagnostics[0].code,'GW_ARGUMENT_REQUIRED');assert.match(r.diagnostics[0].message,/count/);});
test('unknown and mistyped arguments return distinct stable codes',()=>{assert.throws(()=>validateArguments(options,{text:'Hello',count:2,unknown:1}),e=>(e as any).code==='GW_ARGUMENT_UNKNOWN');assert.throws(()=>validateArguments(options,{text:'Hello',count:'2'}),e=>(e as any).code==='GW_ARGUMENT_TYPE');assert.throws(()=>validateArguments(options,{text:'Hello',count:2,enabled:'false'}),e=>(e as any).code==='GW_ARGUMENT_TYPE');});
test('integer, numeric and string bounds reject invalid values',()=>{const cases:Record<string,string|number|boolean>[]=[{text:'a',count:2},{text:'abcdef',count:2},{text:'Hello',count:0},{text:'Hello',count:4},{text:'Hello',count:2,ratio:1.01}];for(const args of cases)assert.throws(()=>validateArguments(options,args),e=>(e as any).code==='GW_ARGUMENT_RANGE');assert.throws(()=>validateArguments(options,{text:'Hello',count:1.1}),e=>(e as any).code==='GW_ARGUMENT_TYPE');assert.throws(()=>validateArguments(options,{text:'Hello',count:2,ratio:Infinity}),e=>(e as any).code==='GW_ARGUMENT_TYPE');});
test('choices and Discord identifier types are checked independently',()=>{assert.throws(()=>validateArguments(options,{text:'Hello',count:2,mode:'invented'}),e=>(e as any).code==='GW_ARGUMENT_CHOICE');for(const field of ['person','room'])assert.throws(()=>validateArguments(options,{text:'Hello',count:2,[field]:'not-an-id'}),e=>(e as any).code==='GW_ARGUMENT_TYPE');});
test('schemas reject duplicate names and incompatible constraints',()=>{assert.throws(()=>validateOptionSchema([options[0],options[0]]),/duplicate/);assert.throws(()=>validateOptionSchema([{name:'flag',description:'Flag',type:'boolean',min:1}]),/bounds/);assert.throws(()=>validateOptionSchema([{name:'text',description:'Text',type:'string',maxLength:0}]),/bounds/);assert.throws(()=>validateOptionSchema([{name:'person',description:'Person',type:'user',choices:[{name:'Someone',value:'123456789012345678'}]}]),/choices/);});
test('Discord manifest preserves types, bounds and choices and puts required options first',()=>{const bot=fixture();bot.commands[0].options=[options[3],...options.filter(o=>o.name!=='enabled')];const opts=commandManifest(bot)[0].options as any[];assert.equal(opts[0].name,'text');assert.equal(opts[1].name,'count');assert.deepEqual(opts.map(o=>o.type),[3,4,5,10,6,7,3]);assert.equal(opts[0].min_length,2);assert.equal(opts[0].max_length,5);assert.equal(opts[1].min_value,1);assert.equal(opts[1].max_value,3);assert.equal(opts.at(-1).choices[0].value,'quiet');});
test('the everyone role cannot be used as the ticket support role',()=>{const env={DISCORD_TOKEN:'private-token',DISCORD_APPLICATION_ID:'123456789012345678',DISCORD_GUILD_ID:'123456789012345679',DISCORD_SUPPORT_ROLE_ID:'123456789012345679'};assert.throws(()=>readConfig(env),/everyone/);assert.doesNotThrow(()=>readConfig({DISCORD_TOKEN:'private-token',DISCORD_APPLICATION_ID:'123456789012345678',DISCORD_GUILD_ID:'123456789012345679'},{tickets:false}));});

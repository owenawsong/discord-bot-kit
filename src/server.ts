import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bot, Input } from './types.js';
import { actors, input, Simulator } from './simulate.js';
import { Store } from './store.js';
import { runScenarios } from './scenarios.js';
export interface Session {actor?:string;kind?:Input['kind'];name?:string;fields?:Record<string,string>;values?:string[];ageMs?:number;dm?:boolean;channelId?:string;args?:Input['args']}
export function validateSession(body:unknown):asserts body is Session {
  const b=body as Session;if(!b||typeof b!=='object'||typeof b.name!=='string'||b.name.length>100||!['command','button','modal','select'].includes(b.kind??'command')||!actors[b.actor??'member']||(b.ageMs!==undefined&&(!Number.isFinite(b.ageMs)||b.ageMs<0||b.ageMs>900000)))throw new Error('Invalid interaction input');
  if(b.fields && (typeof b.fields!=='object'||Array.isArray(b.fields)||Object.entries(b.fields).some(([k,v])=>k.length>100||typeof v!=='string'||v.length>4000)))throw new Error('Invalid modal fields');
  if(b.values && (!Array.isArray(b.values)||b.values.length>25||b.values.some(v=>typeof v!=='string'||v.length>100)))throw new Error('Invalid select values');
  if(b.channelId!==undefined&&(typeof b.channelId!=='string'||b.channelId.length>100))throw new Error('Invalid channel ID');
  if(b.args!==undefined&&(!b.args||typeof b.args!=='object'||Array.isArray(b.args)||Object.keys(b.args).length>25||Object.entries(b.args).some(([key,value])=>key.length>32||!['string','number','boolean'].includes(typeof value)||(typeof value==='string'&&value.length>6000)||(typeof value==='number'&&!Number.isFinite(value)))))throw new Error('Invalid command arguments');
}
async function body(req:IncomingMessage) {let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>32768)throw new Error('Request is too large');}return JSON.parse(text||'{}') as unknown;}
export async function servePlayground(bot:Bot,options:{port?:number;statePath?:string}={}) {
  const store=new Store(options.statePath);await store.load();let simulator=new Simulator(bot,store);
  const session=randomBytes(32).toString('hex');const history:unknown[]=[];
  const publicRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../public');
  const server=createServer(async(req,res)=>{
    try {
      const path=new URL(req.url??'/', 'http://localhost').pathname;
      const address=server.address();const port=typeof address==='object'&&address?address.port:options.port??18874;
      const host=req.headers.host;if(host!==`127.0.0.1:${port}`&&host!==`localhost:${port}`){res.writeHead(403);res.end('Invalid host');return;}
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      if(path.startsWith('/api/')) {
        res.setHeader('Content-Type','application/json');
        if(req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403);res.end(JSON.stringify({error:'Origin rejected'}));return;}
        if(req.method==='POST'&&req.headers['x-guildwright-session']!==session){res.writeHead(403);res.end(JSON.stringify({error:'Session token required'}));return;}
        if(path==='/api/session'&&req.method==='GET'){res.end(JSON.stringify({session,bot:bot.name,recipe:bot.recipe??'custom',commands:bot.commands.map(({handler,...c})=>c),state:store.snapshot(),history}));return;}
        if(path==='/api/run'&&req.method==='POST'){const b=await body(req);validateSession(b);const result=await simulator.run(input(b.name!,{kind:b.kind??'command',actor:actors[b.actor??'member'],fields:b.fields,args:b.args,values:b.values,ageMs:b.ageMs,channelId:b.channelId??'lobby',guildId:b.dm?undefined:'workshop-guild'}));history.push(result);if(history.length>100)history.shift();res.end(JSON.stringify(result));return;}
        if(path==='/api/test'&&req.method==='POST'){res.end(JSON.stringify(await runScenarios(bot)));return;}
        if(path==='/api/reset'&&req.method==='POST'){await store.mutate(s=>{s.tickets=[];s.nextTicket=1;s.events=[];s.nextEvent=1;});history.length=0;simulator=new Simulator(bot,store);res.end(JSON.stringify({state:store.snapshot()}));return;}
        res.writeHead(404);res.end(JSON.stringify({error:'Unknown endpoint'}));return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
      const asset=path==='/'?'index.html':path.slice(1);if(!['index.html','style.css','app.js'].includes(asset)){res.writeHead(404);res.end();return;}
      const data=await readFile(resolve(publicRoot,asset));res.setHeader('Content-Type',extname(asset)==='.html'?'text/html; charset=utf-8':extname(asset)==='.css'?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(req.method==='HEAD'?undefined:data);
    }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e instanceof Error?e.message:'Invalid request'}));}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??18874,'127.0.0.1',resolve);});return server;
}

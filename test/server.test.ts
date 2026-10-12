import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { servePlayground } from '../src/server.js';
import { ticketBot } from '../src/recipes.js';
import { signupBot } from '../src/signups.js';
test('local API protects mutations and runs real handlers',async()=>{
  const server=await servePlayground(ticketBot(),{port:0});const address=server.address();assert(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}`;
  try{const page=await fetch(url);assert.equal(page.status,200);assert.match(await page.text(),/Build the bot/);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
    const session=await (await fetch(url+'/api/session')).json() as {session:string};
    assert.equal((await fetch(url+'/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'ping'})})).status,403);
    assert.equal((await fetch(url+'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Guildwright-Session':session.session,Origin:'https://untrusted.example'},body:'{}'})).status,403);
    const result=await (await fetch(url+'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Guildwright-Session':session.session},body:JSON.stringify({name:'ping'})})).json() as {events:unknown[]};assert.equal(result.events.length,1);
    assert.equal((await fetch(url+'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Guildwright-Session':session.session},body:JSON.stringify({name:'x',actor:'attacker'})})).status,400);
    assert.equal((await fetch(url+'/../../package.json')).status,404);
  }finally{server.close();await once(server,'close');}
});
test('signup HTTP arguments reach shared handlers and reset clears event state',async()=>{
  const server=await servePlayground(signupBot(),{port:0});const address=server.address();assert(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}`;
  try{const session=await (await fetch(url+'/api/session')).json() as {session:string};const request=(path:string,data:unknown)=>fetch(url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Guildwright-Session':session.session},body:JSON.stringify(data)});
    const create=await (await request('run',{name:'event-create',actor:'moderator',args:{title:'HTTP event',capacity:2}})).json() as any;assert.equal(create.state.events.length,1);assert.equal(create.state.events[0].capacity,2);const reset=await (await request('reset',{})).json() as any;assert.deepEqual(reset.state.events,[]);assert.equal(reset.state.nextEvent,1);
  }finally{server.close();await once(server,'close');}
});

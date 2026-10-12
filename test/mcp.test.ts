import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('stdio MCP handshake and local tools return structured evidence',async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/cli.js',import.meta.url)),'mcp'],{stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const completed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`MCP exit ${code}: ${stderr}`)));});
  const timer=setTimeout(()=>child.kill(),15000);
  try{for(const req of [
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'simulate_interaction',arguments:{name:'ping'}}},
    {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'run_ticket_scenarios',arguments:{}}}
  ])child.stdin.write(JSON.stringify(req)+'\n');child.stdin.end();await completed;
    const messages=stdout.trim().split('\n').map(line=>JSON.parse(line));assert.equal(messages.length,4);assert.equal(messages[0].result.serverInfo.name,'guildwright');assert.equal(messages[1].result.tools.length,4);const evidence=JSON.parse(messages[2].result.content[0].text);assert.equal(evidence.events[0].type,'reply');assert.equal(evidence.diagnostics.length,0);assert.equal(JSON.parse(messages[3].result.content[0].text).filter((r:any)=>r.passed).length,11);assert.equal(stderr,'');
  }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
});
test('MCP rejects null and malformed request objects without losing later requests',async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/cli.js',import.meta.url)),'mcp'],{stdio:['pipe','pipe','pipe']});let stdout='';child.stdout.on('data',x=>stdout+=x);const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`Exit ${code}`)));});const timer=setTimeout(()=>child.kill(),15000);
  try{child.stdin.end('null\n[]\n{"jsonrpc":"2.0","id":9,"method":null}\n{"jsonrpc":"2.0","id":10,"method":"ping"}\n');await closed;const result=stdout.trim().split('\n').map(s=>JSON.parse(s));assert.equal(result.length,4);for(const message of result.slice(0,3))assert.equal(message.error.code,-32600);assert.equal(result[3].id,10);assert.deepEqual(result[3].result,{});}finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
});

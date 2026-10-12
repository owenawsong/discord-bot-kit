#!/usr/bin/env node
import { readFile, mkdir, writeFile, cp, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ticketBot } from './recipes.js';
import { signupBot } from './signups.js';
import { runScenarios } from './scenarios.js';
import { runScenario, type Scenario } from './workflow.js';
import { servePlayground } from './server.js';
import { commandManifest, readConfig, registerCommands, startDiscord } from './discord.js';
import { startMcp } from './mcp.js';
import { defineBot } from './core.js';
import type { Bot } from './types.js';
import { Simulator } from './simulate.js';
const args=process.argv.slice(2);const command=args[0]??'help';
function option(name:string) {const index=args.indexOf(name);return index<0?undefined:args[index+1];}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
function recipe() {const name=option('--recipe')??'tickets';if(!['tickets','signups'].includes(name))throw new Error('Recipe must be tickets or signups');return name as 'tickets'|'signups';}
async function loadBot():Promise<Bot> {const path=option('--bot');if(!path)return recipe()==='signups'?signupBot():ticketBot();const imported=await import(pathToFileURL(resolve(path)).href);return defineBot(typeof imported.default==='function'?await imported.default():imported.default);}
function loadEnv() {try{process.loadEnvFile(resolve('.env'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
async function scaffold(destination:string) {
  const selectedRecipe=recipe();
  const target=resolve(destination);try{await stat(target);throw new Error('Destination already exists. Choose a new directory.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  await mkdir(target,{recursive:true});
  await writeFile(join(target,'package.json'),JSON.stringify({name:'my-discord-bot',version:'0.1.0',private:true,type:'module',scripts:{playground:'guildwright playground --bot bot.mjs',test:'guildwright test --bot bot.mjs --scenario scenario.json','test:recipe':'guildwright test --bot bot.mjs',doctor:'guildwright doctor --bot bot.mjs',register:'guildwright register --bot bot.mjs',start:'guildwright start --bot bot.mjs'},dependencies:{'@owenawsong/guildwright':option('--package')??`file:${root.replaceAll('\\','/')}`}},null,2)+'\n');
  const factory=selectedRecipe==='signups'?'signupBot':'ticketBot';
  await writeFile(join(target,'bot.mjs'),`import { ${factory} } from '@owenawsong/guildwright';\n\n// These same handlers run in the workshop and Discord.\nconst bot = ${factory}();\nbot.name = 'My ${selectedRecipe==='signups'?'event':'support'} bot';\nexport default bot;\n`);
  await writeFile(join(target,'.env.example'),'DISCORD_TOKEN=\nDISCORD_APPLICATION_ID=\nDISCORD_GUILD_ID=\n'+(selectedRecipe==='tickets'?'DISCORD_SUPPORT_ROLE_ID=\n':'')+'GUILDWRIGHT_STATE=.guildwright/live-state.json\n');
  await writeFile(join(target,'.gitignore'),'node_modules/\n.env\n.guildwright/\n');
  await cp(join(root,`examples/${selectedRecipe}/scenario.json`),join(target,'scenario.json'));
  await cp(join(root,'skills/guildwright/SKILL.md'),join(target,'AGENTS.md'));
  await cp(join(root,'docs/DISCORD_SETUP.md'),join(target,'DISCORD_SETUP.md'));
  console.log(`Created ${target}\nNext: cd into that directory, npm install, then npm run playground.\nNo Discord credentials are needed for the local workshop.`);
}
try {
  if(command==='init'){if(!args[1]||args[1].startsWith('--'))throw new Error('Usage: guildwright init <new-directory>');await scaffold(args[1]);}
  else if(command==='playground') {const port=Number(option('--port')??18874);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');const server=await servePlayground(await loadBot(),{port,statePath:option('--state')});const address=server.address();console.log(`Guildwright workshop: http://127.0.0.1:${typeof address==='object'&&address?address.port:port}/\nLocal simulation only. Ctrl+C to stop.`);}
  else if(command==='test') {
    const bot=await loadBot();const scenario=option('--scenario');
    if(scenario){const result=await runScenario(bot,JSON.parse(await readFile(resolve(scenario),'utf8')) as Scenario);console.log(args.includes('--json')?JSON.stringify(result,null,2):`${result.passed?'PASS':'FAIL'} ${result.name}\n`+result.steps.map(s=>`${s.passed?'PASS':'FAIL'} step ${s.step}: ${s.name}${s.errors.length?' — '+s.errors.join('; '):''}`).join('\n'));if(!result.passed)process.exitCode=1;}
    else {const results=await runScenarios(bot);console.log(args.includes('--json')?JSON.stringify(results,null,2):results.map(r=>`${r.passed?'PASS':'FAIL'} ${r.name}${r.passed?'':' — '+r.detail}`).join('\n'));if(results.some(r=>!r.passed))process.exitCode=1;}
  }
  else if(command==='inspect') {const bot=await loadBot();console.log(JSON.stringify({name:bot.name,commands:commandManifest(bot),routes:bot.routes.map(({handler,...r})=>r)},null,2));}
  else if(command==='simulate'){const path=option('--input');if(!path)throw new Error('Usage: guildwright simulate --input interaction.json');const value=JSON.parse(await readFile(resolve(path),'utf8'));console.log(JSON.stringify(await new Simulator(await loadBot()).run(value),null,2));}
  else if(command==='mcp')startMcp(await loadBot());
  else if(command==='doctor'){loadEnv();try{const bot=await loadBot();readConfig(process.env,{tickets:bot.recipe!=='signups'});console.log('PASS Node runtime\nPASS required environment variables\nPASS identifier formats\nNOT CHECKED Discord token validity, guild access, role existence and channel permissions (offline check).');}catch(e){console.error(e instanceof Error?e.message:e);process.exitCode=1;}}
  else if(command==='register'){if(args.includes('--apply')){loadEnv();const bot=await loadBot();console.log(JSON.stringify(await registerCommands(bot,readConfig(process.env,{tickets:bot.recipe!=='signups'}),true),null,2));}else console.log(JSON.stringify({apply:false,warning:'Preview only. --apply replaces guild commands for this application.',commands:commandManifest(await loadBot())},null,2));}
  else if(command==='start'){loadEnv();const bot=await loadBot();const client=await startDiscord(bot,readConfig(process.env,{tickets:bot.recipe!=='signups'}));const stop=()=>{client.destroy();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);}
  else if(command==='help')console.log(`Guildwright · build with an agent, prove it locally\n\ninit <dir>       Scaffold a bot [--recipe tickets|signups]\nplayground       Interactive local workshop [--port 18874] [--state path]\ninspect          Command manifest and component routes\ntest             Bundled recipe checks [--scenario path] [--json]\nsimulate         Run an Input JSON file [--input path]\nmcp              Local stdio MCP server\ndoctor           Offline live-deployment configuration checks\nregister         Preview registration [--apply to replace guild commands]\nstart            Connect to Discord using .env\n\nUse --bot path/to/bot.mjs for your own Bot export, or --recipe tickets|signups.\nNode 22.12+ · docs/DISCORD_SETUP.md for real-server setup.`);
  else throw new Error(`Unknown command ${command}. Run guildwright help.`);
} catch(e) {console.error(`Guildwright: ${e instanceof Error?e.message:'Operation failed'}`);process.exitCode=1;}

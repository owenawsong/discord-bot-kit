import type { Bot, Input } from './types.js';
import { Simulator, input, actors } from './simulate.js';
export interface Step { name:string; kind?:Input['kind']; actor?:string; args?:Input['args'];fields?:Record<string,string>;values?:string[];dm?:boolean;ageMs?:number;channelId?:string; expect:{code?:string;event?:string;contentIncludes?:string;ticketCount?:number;ticketStatus?:string;eventCount?:number;eventId?:string;eventStatus?:string;participantCount?:number;clean?:boolean} }
export interface Scenario { name:string;steps:Step[] }
export async function runScenario(bot:Bot,scenario:Scenario) {
  if(!scenario||typeof scenario.name!=='string'||!Array.isArray(scenario.steps)||scenario.steps.length>200)throw new Error('Scenario must have a name and at most 200 steps');
  const sim=new Simulator(bot);const steps=[];
  for(const [index,step] of scenario.steps.entries()) {
    if(!step||typeof step.name!=='string'||!step.expect||!actors[step.actor??'member'])throw new Error(`Invalid scenario step ${index+1}`);
    const allowed=['code','event','contentIncludes','ticketCount','ticketStatus','eventCount','eventId','eventStatus','participantCount','clean'];
    if(Object.keys(step.expect).length===0||Object.keys(step.expect).some(key=>!allowed.includes(key)))throw new Error(`Step ${index+1} needs recognized, nonempty assertions`);
    if(step.expect.ticketCount!==undefined&&(!Number.isSafeInteger(step.expect.ticketCount)||step.expect.ticketCount<0))throw new Error(`Invalid ticketCount in step ${index+1}`);
    for(const key of ['eventCount','participantCount'] as const)if(step.expect[key]!==undefined&&(!Number.isSafeInteger(step.expect[key])||step.expect[key]!<0))throw new Error(`Invalid ${key} in step ${index+1}`);
    if(step.expect.clean!==undefined&&typeof step.expect.clean!=='boolean')throw new Error(`Invalid clean assertion in step ${index+1}`);
    for(const key of ['code','event','contentIncludes','ticketStatus','eventId','eventStatus'] as const)if(step.expect[key]!==undefined&&(typeof step.expect[key]!=='string'||!step.expect[key]))throw new Error(`Invalid ${key} assertion in step ${index+1}`);
    const result=await sim.run(input(step.name,{kind:step.kind??'command',actor:actors[step.actor??'member'],fields:step.fields,args:step.args,values:step.values,guildId:step.dm?undefined:'workshop-guild',channelId:step.channelId??'lobby',ageMs:step.ageMs}));
    const errors:string[]=[];const e=step.expect;
    if(e.code&&!result.diagnostics.some(d=>d.code===e.code))errors.push(`Expected diagnostic ${e.code}`);
    if(e.clean&&result.diagnostics.length)errors.push(`Expected no diagnostics, got ${result.diagnostics.map(d=>d.code).join(', ')}`);
    if(e.event&&!result.events.some(v=>v.type===e.event))errors.push(`Expected event ${e.event}`);
    if(e.contentIncludes&&!result.events.some(v=>v.data&&typeof v.data==='object'&&'content' in v.data&&String(v.data.content).includes(e.contentIncludes!)))errors.push(`Expected content containing ${e.contentIncludes}`);
    if(e.ticketCount!==undefined&&result.state.tickets.length!==e.ticketCount)errors.push(`Expected ${e.ticketCount} tickets, got ${result.state.tickets.length}`);
    if(e.ticketStatus&&!result.state.tickets.some(t=>t.status===e.ticketStatus))errors.push(`Expected a ${e.ticketStatus} ticket`);
    const signup=e.eventId?result.state.events.find(event=>event.id===e.eventId):result.state.events.at(-1);
    if(e.eventCount!==undefined&&result.state.events.length!==e.eventCount)errors.push(`Expected ${e.eventCount} events, got ${result.state.events.length}`);
    if(e.eventId&&!signup)errors.push(`Expected event ${e.eventId}`);
    if(e.eventStatus&&signup?.status!==e.eventStatus)errors.push(`Expected event status ${e.eventStatus}`);
    if(e.participantCount!==undefined&&signup?.participants.length!==e.participantCount)errors.push(`Expected ${e.participantCount} participants, got ${signup?.participants.length??'no event'}`);
    steps.push({step:index+1,name:step.name,passed:errors.length===0,errors,result});
  }
  return {name:scenario.name,passed:steps.every(s=>s.passed),steps};
}

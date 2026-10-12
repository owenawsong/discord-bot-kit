import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { State } from './types.js';
export const emptyState = (): State => ({version:1,tickets:[],nextTicket:1,events:[],nextEvent:1});
export function validateState(value:unknown): asserts value is State {
  const s = value as State;
  if (!s || s.version!==1 || !Array.isArray(s.tickets) || !Number.isSafeInteger(s.nextTicket) || s.nextTicket<1) throw new Error('Unsupported or corrupted Guildwright state. Preserve the file and inspect it; it will not be overwritten.');
  const ids = new Set<string>();
  for(const t of s.tickets) {
    if (!t || typeof t.id!=='string' || ids.has(t.id) || typeof t.owner!=='string' || typeof t.guildId!=='string' || typeof t.topic!=='string' || !['provisioning','open','closing','closed'].includes(t.status) || typeof t.createdAt!=='string' || (t.channelId!==undefined && typeof t.channelId!=='string')) throw new Error('Invalid ticket record in state');
    ids.add(t.id);
  }
  if(!Array.isArray(s.events)||!Number.isSafeInteger(s.nextEvent)||s.nextEvent<1)throw new Error('Invalid signup state');
  const eventIds=new Set<string>();
  for(const e of s.events) {
    if(!e||typeof e.id!=='string'||eventIds.has(e.id)||typeof e.guildId!=='string'||typeof e.owner!=='string'||typeof e.title!=='string'||e.title.length<1||e.title.length>120||!Number.isSafeInteger(e.capacity)||e.capacity<1||e.capacity>1000||!Array.isArray(e.participants)||e.participants.some(p=>typeof p!=='string')||new Set(e.participants).size!==e.participants.length||e.participants.length>e.capacity||!['open','closed'].includes(e.status)||typeof e.createdAt!=='string')throw new Error('Invalid signup event record');
    eventIds.add(e.id);
  }
}
/** One writer per store. Writes commit only after an atomic rename succeeds. */
export class Store {
  private queue:Promise<unknown> = Promise.resolve();
  private state:State = emptyState();
  constructor(readonly path?:string) {}
  async load() {
    if (!this.path) return;
    try { const parsed=JSON.parse(await readFile(this.path,'utf8')) as Partial<State>;if(parsed.version===1&&parsed.events===undefined&&parsed.nextEvent===undefined){parsed.events=[];parsed.nextEvent=1;}validateState(parsed);this.state=parsed; }
    catch(e) { if ((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
  }
  snapshot():State { return structuredClone(this.state); }
  async mutate<T>(fn:(state:State)=>T|Promise<T>):Promise<T> {
    const next=this.queue.then(async()=> {
      const draft=this.snapshot();const result=await fn(draft);validateState(draft);
      if(this.path) {await mkdir(dirname(this.path),{recursive:true});const tmp=this.path+'.tmp';await writeFile(tmp,JSON.stringify(draft,null,2)+'\n',{mode:0o600});await rename(tmp,this.path);}
      this.state=draft;return result;
    });
    this.queue=next.catch(()=>undefined);return next;
  }
}

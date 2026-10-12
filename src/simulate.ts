import { randomUUID } from 'node:crypto';
import type { Actor, Bot, Input, Port, Ticket } from './types.js';
import { Store } from './store.js';
import { execute } from './core.js';
export const actors:Record<string,Actor>={
  member:{id:'member-1',name:'Mira',permissions:['ViewChannel','SendMessages']},
  stranger:{id:'member-2',name:'Rowan',permissions:['ViewChannel','SendMessages']},
  moderator:{id:'mod-1',name:'Alex',permissions:['ManageChannels','ManageGuild','ViewChannel','SendMessages']}
};
export function input(name:string,options:Partial<Input>={}):Input {return {id:randomUUID(),kind:'command',name,actor:structuredClone(actors.member),guildId:'workshop-guild',channelId:'lobby',...options};}
export class Simulator {
  readonly channels=new Map<string,Ticket>();
  readonly port:Port={send:async()=>{},createTicket:async ticket=>{const id=`channel-${ticket.id}`;this.channels.set(id,structuredClone(ticket));return id;},closeTicket:async ticket=>{if(ticket.channelId)this.channels.delete(ticket.channelId);}};
  constructor(readonly bot:Bot,readonly store=new Store()) {}
  async run(value:Input) {return execute(this.bot,value,this.store,this.port);}
}

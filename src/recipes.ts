import { defineBot, Fault, type Context } from './core.js';
import type { Ticket } from './types.js';
async function closeTicket(ctx:Context,id:string) {
  const guild=ctx.requireGuild();
  const ticket=ctx.store.snapshot().tickets.find(t=>t.id===id&&t.guildId===guild);
  if(!ticket)throw new Fault('GW_TICKET_MISSING','This ticket no longer exists.','Look up components against current state and guild scope.');
  if(ticket.owner!==ctx.input.actor.id&&!ctx.input.actor.permissions.includes('ManageChannels'))throw new Fault('GW_PERMISSION_DENIED','Only the ticket owner or a moderator can close this ticket.','Check authorization on every component click.');
  await ctx.defer();
  const reserved=await ctx.store.mutate(s=>{const t=s.tickets.find(t=>t.id===id)!;if(t.status!=='open')return false;t.status='closing';return true;});
  if(!reserved){await ctx.edit({content:ticket.status==='closed'?'This ticket is already closed.':'This ticket is being processed. Try /status shortly.',ephemeral:true});return;}
  try {await ctx.port.closeTicket(ticket);await ctx.store.mutate(s=>{s.tickets.find(t=>t.id===id)!.status='closed';});}
  catch {throw new Fault('GW_CLOSE_INCOMPLETE',`${id} is awaiting close recovery.`,'Reconcile the closing record; do not blindly repeat the side effect.');}
  await ctx.effect('ticket.closed',{ticketId:id});await ctx.edit({content:`${id} is closed. The channel is archived, not deleted.`,ephemeral:true});
}
export function ticketBot() {
  return defineBot({name:'Workshop bot',recipe:'tickets',commands:[
    {name:'ping',description:'Check the bot is responding',handler:async ctx=>{await ctx.reply({content:'Pong. Your bot is listening.',ephemeral:true});}},
    {name:'ticket',description:'Open a private support ticket',handler:async ctx=>{
      ctx.requireGuild();await ctx.modal({id:'ticket:create',title:'Open a support ticket',fields:[{id:'topic',label:'What do you need help with?',maxLength:500}]});
    }},
    {name:'close-ticket',description:'Close the ticket in this channel',handler:async ctx=> {
      const guild=ctx.requireGuild();const ticket=ctx.store.snapshot().tickets.find(t=>t.guildId===guild&&t.channelId===ctx.input.channelId);
      if(!ticket)throw new Fault('GW_TICKET_MISSING','Run this command inside a ticket channel.','Resolve the ticket from current guild and channel state.');
      await closeTicket(ctx,ticket.id);
    }},
    {name:'status',description:'Show your active tickets',handler:async ctx=> {
      const guild=ctx.requireGuild();const tickets=ctx.store.snapshot().tickets.filter(t=>t.guildId===guild&&t.owner===ctx.input.actor.id&&t.status!=='closed');
      await ctx.reply({content:tickets.length?tickets.map(t=>`${t.id} · ${t.status}${t.channelId?' · <#'+t.channelId+'>':''}`).join('\n'):'You have no active tickets.',ephemeral:true});
    }},
    {name:'settings',description:'Choose a workshop notification preference',handler:async ctx=>{await ctx.reply({content:'Choose how you want ticket updates delivered. This example does not persist the preference.',ephemeral:true,select:{id:'preferences:choose',placeholder:'Notification preference',options:[{label:'All updates',value:'all'},{label:'Important updates',value:'important'},{label:'No notifications',value:'none'}]}});}},
    {name:'audit',description:'Inspect ticket counts as a moderator',permission:'ManageChannels',handler:async ctx=>{
      const guild=ctx.requireGuild();const tickets=ctx.store.snapshot().tickets.filter(t=>t.guildId===guild);await ctx.reply({content:`${tickets.filter(t=>t.status==='open').length} open · ${tickets.filter(t=>t.status==='closed').length} closed`,ephemeral:true});
    }}
  ],routes:[
    {kind:'modal',prefix:'ticket:create',handler:async ctx=>{
      const guild=ctx.requireGuild();const topic=ctx.input.fields?.topic?.trim();if(!topic||topic.length>500)throw new Fault('GW_INPUT_INVALID','Describe the issue using 1–500 characters.','Validate modal fields in the handler.');
      await ctx.defer();
      let created=false;
      const ticket=await ctx.store.mutate(s=>{
        const existing=s.tickets.find(t=>t.owner===ctx.input.actor.id&&t.guildId===guild&&t.status!=='closed');if(existing)return structuredClone(existing);
        const t:Ticket={id:`ticket-${s.nextTicket++}`,guildId:guild,owner:ctx.input.actor.id,topic,status:'provisioning',createdAt:new Date().toISOString()};s.tickets.push(t);created=true;return structuredClone(t);
      });
      if(!created) {await ctx.edit({content:ticket.status==='provisioning'?`${ticket.id} is still being prepared. Use /status shortly.`:`You already have ${ticket.id}.${ticket.channelId?' <#'+ticket.channelId+'>':''}`,ephemeral:true});return;}
      let channelId:string;
      try {
        channelId=await ctx.port.createTicket(ticket);
        await ctx.store.mutate(s=>{const t=s.tickets.find(t=>t.id===ticket.id)!;t.channelId=channelId;t.status='open';});
      }catch(e) {
        if(e instanceof Fault && ['GW_BOT_PERMISSION','GW_SUPPORT_ROLE_MISSING'].includes(e.code)) {
          await ctx.store.mutate(s=>{s.tickets=s.tickets.filter(t=>t.id!==ticket.id);});throw e;
        }
        // Keep the reservation: a network timeout may have created the channel. Reconcile instead of creating duplicates.
        throw new Fault('GW_PROVISION_INCOMPLETE',`${ticket.id} is awaiting recovery. A moderator must reconcile it before retrying.`,'Restart the bot in the test guild to reconcile existing channels, then inspect /status. The durable reservation prevents duplicate channels.');
      }
      await ctx.effect('ticket.opened',{ticketId:ticket.id,channelId});
      await ctx.edit({content:`Your ticket is open: <#${channelId}>\n${ticket.id} · ${topic}`,ephemeral:true,buttons:[{id:`ticket:close:${ticket.id}`,label:'Close ticket',style:'danger'}]});
    }},
    {kind:'button',prefix:'ticket:close:',handler:async ctx=>{
      await closeTicket(ctx,ctx.input.name.slice('ticket:close:'.length));
    }},
    {kind:'select',prefix:'preferences:choose',handler:async ctx=> {const choice=ctx.input.values?.[0];if(!['all','important','none'].includes(choice??''))throw new Fault('GW_INPUT_INVALID','Choose a valid notification preference.','Validate select values server-side.');await ctx.reply({content:`Preview preference: ${choice}. No notification service is connected.`,ephemeral:true});}}
  ]});
}

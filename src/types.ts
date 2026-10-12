export type Permission = 'ManageChannels' | 'ManageGuild' | 'SendMessages' | 'ViewChannel';
export interface Actor { id: string; name: string; permissions: Permission[] }
export interface Input {
  id: string; kind: 'command' | 'button' | 'modal' | 'select'; name: string;
  actor: Actor; guildId?: string; channelId?: string; fields?: Record<string,string>;
  values?: string[]; ageMs?: number;
  args?: Record<string,string|number|boolean>;
}
export interface Button { id: string; label: string; style?: 'primary' | 'danger' | 'secondary' }
export interface Select { id: string; placeholder: string; options: {label:string;value:string}[] }
export interface Message { content: string; ephemeral?: boolean; buttons?: Button[]; select?: Select }
export interface Modal { id:string; title:string; fields:{id:string;label:string;maxLength?:number}[] }
export interface Event { type: 'reply' | 'defer' | 'deferUpdate' | 'edit' | 'followup' | 'modal' | 'effect'; data: unknown; at: number }
export interface Diagnostic { code: string; severity: 'error' | 'warning'; message: string; remedy: string }
export interface Port {
  send(type: Event['type'], data: unknown): Promise<void>;
  createTicket(ticket: Ticket): Promise<string>;
  closeTicket(ticket: Ticket): Promise<void>;
}
export interface Ticket { id:string; guildId:string; owner:string; topic:string; channelId?:string; status:'provisioning'|'open'|'closing'|'closed'; createdAt:string }
export interface SignupEvent { id:string;guildId:string;owner:string;title:string;capacity:number;participants:string[];status:'open'|'closed';createdAt:string }
export interface State { version:1; tickets:Ticket[]; nextTicket:number; events:SignupEvent[];nextEvent:number }
export interface Execution { input:Input; events:Event[]; diagnostics:Diagnostic[]; elapsedMs:number; state:State }
export interface CommandOption {
  name:string;description:string;type:'string'|'number'|'integer'|'boolean'|'user'|'channel';required?:boolean;
  choices?:{name:string;value:string|number}[];min?:number;max?:number;minLength?:number;maxLength?:number;
}
export interface Command { name:string; description:string; permission?:Permission; options?:CommandOption[];handler:(ctx: import('./core.js').Context)=>Promise<void> }
export interface Route { prefix:string; kind:'button'|'modal'|'select'; permission?:Permission; handler:(ctx:import('./core.js').Context)=>Promise<void> }
export interface Bot { name:string;recipe?:'tickets'|'signups';commands:Command[]; routes:Route[] }

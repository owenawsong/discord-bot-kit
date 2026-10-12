import { randomUUID } from "node:crypto";
import type {
  Actor,
  Bot,
  Input,
  Port,
  Ticket,
  SimulationFault,
} from "./types.js";
import { Store } from "./store.js";
import { execute } from "./core.js";
import { PermissionFlagsBits } from "discord.js";
export function validateInput(value: unknown): asserts value is Input {
  const v = value as Input;
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    typeof v.id !== "string" ||
    v.id.length < 1 ||
    v.id.length > 128 ||
    !["command", "button", "modal", "select"].includes(v.kind) ||
    typeof v.name !== "string" ||
    v.name.length < 1 ||
    v.name.length > 100 ||
    !v.actor ||
    typeof v.actor.id !== "string" ||
    v.actor.id.length < 1 ||
    v.actor.id.length > 100 ||
    typeof v.actor.name !== "string" ||
    v.actor.name.length > 100 ||
    !Array.isArray(v.actor.permissions) ||
    v.actor.permissions.some(
      (p) => typeof p !== "string" || !Object.hasOwn(PermissionFlagsBits, p),
    )
  )
    throw new Error("Invalid interaction input");
  for (const key of ["guildId", "channelId"] as const)
    if (
      v[key] !== undefined &&
      (typeof v[key] !== "string" || v[key]!.length < 1 || v[key]!.length > 100)
    )
      throw new Error(`Invalid ${key}`);
  if (
    v.ageMs !== undefined &&
    (!Number.isFinite(v.ageMs) || v.ageMs < 0 || v.ageMs > 900000)
  )
    throw new Error("Invalid interaction age");
  if (
    v.args !== undefined &&
    (!v.args ||
      typeof v.args !== "object" ||
      Array.isArray(v.args) ||
      Object.entries(v.args).length > 25 ||
      Object.entries(v.args).some(
        ([name, value]) =>
          name.length > 32 ||
          !["string", "number", "boolean"].includes(typeof value) ||
          (typeof value === "number" && !Number.isFinite(value)) ||
          (typeof value === "string" && value.length > 6000),
      ))
  )
    throw new Error("Invalid command args");
  if (
    v.fields !== undefined &&
    (!v.fields ||
      typeof v.fields !== "object" ||
      Array.isArray(v.fields) ||
      Object.entries(v.fields).length > 25 ||
      Object.entries(v.fields).some(
        ([name, value]) =>
          name.length > 100 || typeof value !== "string" || value.length > 4000,
      ))
  )
    throw new Error("Invalid modal fields");
  if (
    v.values !== undefined &&
    (!Array.isArray(v.values) ||
      v.values.length > 25 ||
      v.values.some((value) => typeof value !== "string" || value.length > 100))
  )
    throw new Error("Invalid select values");
}
export const actors: Record<string, Actor> = {
  member: {
    id: "member-1",
    name: "Mira",
    permissions: ["ViewChannel", "SendMessages"],
  },
  stranger: {
    id: "member-2",
    name: "Rowan",
    permissions: ["ViewChannel", "SendMessages"],
  },
  moderator: {
    id: "mod-1",
    name: "Alex",
    permissions: [
      "ManageChannels",
      "ManageGuild",
      "ViewChannel",
      "SendMessages",
    ],
  },
};
export function input(name: string, options: Partial<Input> = {}): Input {
  return {
    id: randomUUID(),
    kind: "command",
    name,
    actor: structuredClone(actors.member),
    guildId: "workshop-guild",
    channelId: "lobby",
    ...options,
  };
}
export type FaultFixture = SimulationFault;
export function validateFaults(faults: FaultFixture) {
  if (
    !faults ||
    typeof faults !== "object" ||
    Array.isArray(faults) ||
    Object.keys(faults).some(
      (k) =>
        !["send", "createTicket", "closeTicket", "delaySendMs"].includes(k),
    ) ||
    (faults.send !== undefined &&
      ![
        "reply",
        "defer",
        "deferUpdate",
        "edit",
        "followup",
        "modal",
        "effect",
      ].includes(faults.send)) ||
    [faults.createTicket, faults.closeTicket].some(
      (v) => v !== undefined && !["before", "after"].includes(v),
    ) ||
    (faults.delaySendMs !== undefined &&
      (!Number.isInteger(faults.delaySendMs) ||
        faults.delaySendMs < 0 ||
        faults.delaySendMs > 3000))
  )
    throw new Error("Invalid simulation fault fixture");
}
export class Simulator {
  readonly channels = new Map<string, Ticket & { archived?: boolean }>();
  readonly port: Port = {
    send: async () => {},
    createTicket: async (ticket) => {
      const id = `channel-${ticket.id}`;
      this.channels.set(id, {
        ...structuredClone(ticket),
        channelId: id,
        status: "open",
        archived: false,
      });
      return id;
    },
    closeTicket: async (ticket) => {
      if (ticket.channelId && this.channels.has(ticket.channelId)) {
        const channel = this.channels.get(ticket.channelId)!;
        channel.status = "closed";
        channel.archived = true;
      }
    },
  };
  constructor(
    readonly bot: Bot,
    readonly store = new Store(),
  ) {
    store.configure(bot.stateSchemas);
    for (const ticket of store.snapshot().tickets)
      if (ticket.channelId)
        this.channels.set(ticket.channelId, {
          ...ticket,
          status: ticket.status === "closed" ? "closed" : "open",
          archived: ticket.status === "closed",
        });
  }
  async run(value: Input, faults?: FaultFixture) {
    validateInput(value);
    value = structuredClone(value);
    let port = this.port;
    if (faults) {
      validateFaults(faults);
      const base = this.port;
      let failed = false;
      port = {
        send: async (type, data) => {
          if (faults.delaySendMs)
            await new Promise((r) => setTimeout(r, faults.delaySendMs));
          if (faults.send === type && !failed) {
            failed = true;
            throw new Error("Injected transport failure");
          }
          await base.send(type, data);
        },
        createTicket: async (ticket) => {
          if (faults.createTicket === "before")
            throw new Error("Injected failure before channel creation");
          const result = await base.createTicket(ticket);
          if (faults.createTicket === "after")
            throw new Error(
              "Injected ambiguous failure after channel creation",
            );
          return result;
        },
        closeTicket: async (ticket) => {
          if (faults.closeTicket === "before")
            throw new Error("Injected failure before channel closure");
          await base.closeTicket(ticket);
          if (faults.closeTicket === "after")
            throw new Error("Injected ambiguous failure after channel closure");
        },
      };
    }
    const result = await execute(this.bot, value, this.store, port);
    return {
      ...result,
      simulation: {
        channels: Object.fromEntries(
          [...this.channels].map(([id, ticket]) => [
            id,
            structuredClone(ticket),
          ]),
        ),
        ...(faults ? { faults: structuredClone(faults) } : {}),
      },
    };
  }
}

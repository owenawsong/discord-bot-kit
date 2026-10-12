import { defineBot, Fault, type Context } from "./core.js";
import type { SignupEvent, Message } from "./types.js";
import type { Store } from "./store.js";
const eventQueues = new WeakMap<Store, Map<string, Promise<unknown>>>();
async function serializeEvent<T>(
  ctx: Context,
  id: string,
  fn: () => Promise<T>,
): Promise<T> {
  let queues = eventQueues.get(ctx.store);
  if (!queues) {
    queues = new Map();
    eventQueues.set(ctx.store, queues);
  }
  const key = `${ctx.input.guildId}:${id}`;
  const next = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(fn);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}
function card(event: SignupEvent): Message {
  return {
    content: `${event.title}\n${event.id} · ${event.status}\n${event.participants.length}/${event.capacity} places filled${event.participants.length === event.capacity ? " · Full" : ""}`,
    buttons:
      event.status === "open"
        ? [
            {
              id: `event:join:${event.id}`,
              label: "Join event",
              style: "primary",
            },
            {
              id: `event:leave:${event.id}`,
              label: "Leave event",
              style: "secondary",
            },
            {
              id: `event:close:${event.id}`,
              label: "Close signups",
              style: "danger",
            },
          ]
        : [],
  };
}
function eventId(ctx: Context) {
  return String(ctx.args.event);
}
function lookup(ctx: Context, id: string): SignupEvent {
  const guild = ctx.requireGuild();
  const event = ctx.store
    .snapshot()
    .events.find((e) => e.guildId === guild && e.id === id);
  if (!event)
    throw new Fault(
      "GW_EVENT_MISSING",
      "This event does not exist in this server.",
      "Resolve the event against current guild-scoped durable state.",
    );
  return event;
}
async function membership(ctx: Context, id: string, action: "join" | "leave") {
  lookup(ctx, id);
  const guild = ctx.requireGuild();
  if (ctx.input.kind === "button") await ctx.deferUpdate();
  else await ctx.defer();
  await serializeEvent(ctx, id, async () => {
    const outcome = await ctx.store.mutate((state) => {
      const event = state.events.find(
        (e) => e.guildId === guild && e.id === id,
      )!;
      if (event.status !== "open")
        throw new Fault(
          "GW_EVENT_CLOSED",
          "Signups for this event are closed.",
          "Keep closed rosters immutable; use the current event status instead of stale button state.",
        );
      const index = event.participants.indexOf(ctx.input.actor.id);
      if (action === "join") {
        if (index !== -1)
          return { event: structuredClone(event), changed: false };
        if (event.participants.length >= event.capacity)
          throw new Fault(
            "GW_EVENT_FULL",
            "This event is full.",
            "Check capacity inside the same transaction that adds a participant.",
          );
        event.participants.push(ctx.input.actor.id);
      } else {
        if (index === -1)
          return { event: structuredClone(event), changed: false };
        event.participants.splice(index, 1);
      }
      return { event: structuredClone(event), changed: true };
    });
    if (outcome.changed)
      await ctx.effect(`event.${action === "join" ? "joined" : "left"}`, {
        eventId: id,
        participant: ctx.input.actor.id,
      });
    if (ctx.input.kind === "button") await ctx.edit(card(outcome.event));
    else
      await ctx.edit({
        content: `${outcome.changed ? (action === "join" ? "You joined" : "You left") : action === "join" ? "You are already signed up for" : "You were not signed up for"} ${outcome.event.title}.\n${outcome.event.participants.length}/${outcome.event.capacity} places filled.`,
        ephemeral: true,
      });
  });
}
async function close(ctx: Context, id: string) {
  const found = lookup(ctx, id);
  if (
    found.owner !== ctx.input.actor.id &&
    !ctx.input.actor.permissions.includes("ManageGuild")
  )
    throw new Fault(
      "GW_PERMISSION_DENIED",
      "Only the event creator or a server manager can close signups.",
      "Authorize component actions against the stored owner and current server permissions.",
    );
  if (ctx.input.kind === "button") await ctx.deferUpdate();
  else await ctx.defer();
  await serializeEvent(ctx, id, async () => {
    const outcome = await ctx.store.mutate((s) => {
      const e = s.events.find(
        (e) => e.id === id && e.guildId === ctx.input.guildId,
      )!;
      const changed = e.status !== "closed";
      e.status = "closed";
      return { event: structuredClone(e), changed };
    });
    if (outcome.changed) await ctx.effect("event.closed", { eventId: id });
    await ctx.edit(
      ctx.input.kind === "button"
        ? card(outcome.event)
        : {
            content: `${id} signups are closed. ${outcome.event.participants.length} participants retained.`,
            ephemeral: true,
          },
    );
  });
}
const idOption = {
  name: "event",
  description: "Event identifier, such as event-1",
  type: "string" as const,
  required: true,
  minLength: 7,
  maxLength: 64,
};
export function signupBot() {
  return defineBot({
    name: "Event signup bot",
    recipe: "signups",
    commands: [
      {
        name: "event-create",
        description: "Create a public event signup",
        permission: "ManageGuild",
        options: [
          {
            name: "title",
            description: "Name of the event",
            type: "string",
            required: true,
            minLength: 1,
            maxLength: 120,
          },
          {
            name: "capacity",
            description: "Maximum number of participants",
            type: "integer",
            required: true,
            min: 1,
            max: 1000,
          },
        ],
        handler: async (ctx) => {
          const guild = ctx.requireGuild();
          const title = String(ctx.args.title).trim();
          if (!title)
            throw new Fault(
              "GW_INPUT_INVALID",
              "The event title cannot be blank.",
              "Trim and validate titles before reserving state.",
            );
          await ctx.defer(false);
          const event = await ctx.store.mutate((s) => {
            const e: SignupEvent = {
              id: `event-${s.nextEvent++}`,
              guildId: guild,
              owner: ctx.input.actor.id,
              title,
              capacity: Number(ctx.args.capacity),
              participants: [],
              status: "open",
              createdAt: new Date().toISOString(),
            };
            s.events.push(e);
            return structuredClone(e);
          });
          await ctx.effect("event.created", { eventId: event.id });
          await ctx.edit(card(event));
        },
      },
      {
        name: "event-show",
        description: "Show the current signup card",
        options: [idOption],
        handler: async (ctx) => {
          await ctx.reply(card(lookup(ctx, eventId(ctx))));
        },
      },
      {
        name: "event-list",
        description: "List events in this server",
        options: [
          {
            name: "page",
            description: "Page number (five events per page)",
            type: "integer",
            min: 1,
            max: 1000000,
          },
        ],
        handler: async (ctx) => {
          const guild = ctx.requireGuild();
          const events = ctx.store
            .snapshot()
            .events.filter((e) => e.guildId === guild)
            .reverse();
          const page = Number(ctx.args.page ?? 1);
          const total = Math.max(1, Math.ceil(events.length / 5));
          if (page > total)
            throw new Fault(
              "GW_INPUT_INVALID",
              `Page ${page} does not exist. There are ${total} pages.`,
              "Choose a page from the current event-list total.",
            );
          await ctx.reply({
            content: events.length
              ? `Events · page ${page}/${total}\n` +
                events
                  .slice((page - 1) * 5, page * 5)
                  .map(
                    (e) =>
                      `${e.id} · ${e.title} · ${e.participants.length}/${e.capacity} · ${e.status}`,
                  )
                  .join("\n")
              : "No events yet.",
            ephemeral: true,
          });
        },
      },
      {
        name: "event-join",
        description: "Join an event",
        options: [idOption],
        handler: async (ctx) => membership(ctx, eventId(ctx), "join"),
      },
      {
        name: "event-leave",
        description: "Leave an event",
        options: [idOption],
        handler: async (ctx) => membership(ctx, eventId(ctx), "leave"),
      },
      {
        name: "event-close",
        description: "Close signups and retain the roster",
        options: [idOption],
        handler: async (ctx) => close(ctx, eventId(ctx)),
      },
    ],
    routes: [
      {
        kind: "button",
        prefix: "event:join:",
        handler: async (ctx) =>
          membership(ctx, ctx.input.name.slice("event:join:".length), "join"),
      },
      {
        kind: "button",
        prefix: "event:leave:",
        handler: async (ctx) =>
          membership(ctx, ctx.input.name.slice("event:leave:".length), "leave"),
      },
      {
        kind: "button",
        prefix: "event:close:",
        handler: async (ctx) =>
          close(ctx, ctx.input.name.slice("event:close:".length)),
      },
    ],
  });
}

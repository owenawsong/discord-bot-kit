import { defineBot, Fault, type Context } from "./core.js";
import { defineNamespace } from "./namespaces.js";
import type { Message } from "./types.js";
import type { AutocompleteContext } from "./autocomplete.js";
export type Poll = {
  id: string;
  question: string;
  owner: string;
  options: string[];
  votes: Record<string, number>;
  closed: boolean;
};
export type PollState = { nextId: number; polls: Record<string, Poll> };
export const pollSchema = defineNamespace<PollState>({
  name: "polls",
  version: 1,
  initial: { nextId: 1, polls: {} },
  validate: (value) => {
    const s = value as PollState;
    if (
      !s ||
      !Number.isSafeInteger(s.nextId) ||
      s.nextId < 1 ||
      !s.polls ||
      typeof s.polls !== "object" ||
      Array.isArray(s.polls)
    )
      return false;
    return Object.entries(s.polls).every(
      ([id, p]) =>
        p &&
        p.id === id &&
        /^poll-[1-9][0-9]*$/.test(id) &&
        typeof p.question === "string" &&
        p.question.length > 0 &&
        p.question.length <= 160 &&
        typeof p.owner === "string" &&
        Array.isArray(p.options) &&
        p.options.length >= 2 &&
        p.options.length <= 10 &&
        new Set(p.options).size === p.options.length &&
        p.options.every(
          (o) => typeof o === "string" && o.length > 0 && o.length <= 100,
        ) &&
        typeof p.closed === "boolean" &&
        p.votes &&
        typeof p.votes === "object" &&
        !Array.isArray(p.votes) &&
        Object.values(p.votes).every(
          (v) => Number.isInteger(v) && v >= 0 && v < p.options.length,
        ),
    );
  },
});
function state(ctx: Context) {
  return ctx.state<PollState>("polls");
}
function get(ctx: Context, id: string) {
  const value = state(ctx).snapshot().polls;
  const p = Object.hasOwn(value, id) ? value[id] : undefined;
  if (!p)
    throw new Fault(
      "GW_POLL_MISSING",
      "This poll does not exist in this server.",
      "Resolve the poll against the current guild-scoped namespace.",
    );
  return p;
}
function card(p: Poll): Message {
  const counts = p.options.map(
    (_, i) => Object.values(p.votes).filter((v) => v === i).length,
  );
  return {
    embeds: [
      {
        title: p.question,
        color: p.closed ? 0x87938e : 0xdafa73,
        description: `${p.id} · ${p.closed ? "Closed" : "Open"} · ${Object.keys(p.votes).length} votes`,
        fields: p.options.map((option, i) => ({
          name: `${i + 1}. ${option}`,
          value: `${counts[i]} vote${counts[i] === 1 ? "" : "s"}`,
          inline: true,
        })),
        footer: {
          text: p.closed
            ? "Results retained. Voting is closed."
            : "One vote per member. Choose again to change your vote.",
        },
      },
    ],
    ...(p.closed
      ? {}
      : {
          select: {
            id: `poll:vote:${p.id}`,
            placeholder: "Choose your answer",
            options: p.options.map((label, i) => ({ label, value: String(i) })),
          },
          buttons: [
            {
              id: `poll:close:${p.id}`,
              label: "Close poll",
              style: "danger" as const,
            },
          ],
        }),
  };
}
async function suggest(ctx: AutocompleteContext) {
  const polls = ctx.state<PollState>("polls").snapshot().polls;
  if (ctx.focused.name === "poll") {
    const query = String(ctx.focused.value).toLowerCase();
    return Object.values(polls)
      .filter((p) => `${p.id} ${p.question}`.toLowerCase().includes(query))
      .slice(-25)
      .map((p) => ({
        name: `${p.id} · ${p.question}`.slice(0, 100),
        value: p.id,
      }));
  }
  const p = polls[String(ctx.args.poll)];
  if (!p || p.closed) return [];
  return p.options
    .map((label, i) => ({
      name: `${i + 1}. ${label}`.slice(0, 100),
      value: i + 1,
    }))
    .filter((c) =>
      c.name.toLowerCase().includes(String(ctx.focused.value).toLowerCase()),
    );
}
async function vote(ctx: Context, id: string, choice: number) {
  get(ctx, id);
  if (ctx.input.kind === "select") await ctx.deferUpdate();
  else await ctx.defer();
  await ctx.serial("poll:" + id, async () => {
    const outcome = await state(ctx).transact((s) => {
      const p = s.polls[id];
      if (p.closed)
        throw new Fault(
          "GW_POLL_CLOSED",
          "This poll is closed.",
          "Check current state for every vote, including stale components.",
        );
      if (!Number.isInteger(choice) || choice < 0 || choice >= p.options.length)
        throw new Fault(
          "GW_INPUT_INVALID",
          "Choose one of this poll's answers.",
          "Validate choice indices against the stored poll options.",
        );
      const changed = p.votes[ctx.input.actor.id] !== choice;
      Object.defineProperty(p.votes, ctx.input.actor.id, {
        value: choice,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return { poll: p, changed };
    });
    const p = outcome.poll;
    if (outcome.changed) await ctx.effect("poll.voted", { pollId: id });
    await ctx.edit(
      ctx.input.kind === "select"
        ? card(p)
        : {
            content: `Your vote for ${p.options[choice]} is recorded.`,
            ephemeral: true,
            embeds: card(p).embeds,
          },
    );
  });
}
async function close(ctx: Context, id: string) {
  const found = get(ctx, id);
  if (
    found.owner !== ctx.input.actor.id &&
    !ctx.input.actor.permissions.includes("ManageGuild")
  )
    throw new Fault(
      "GW_PERMISSION_DENIED",
      "Only the poll creator or a server manager can close it.",
      "Check ownership in durable guild state on command and component paths.",
    );
  if (ctx.input.kind === "button") await ctx.deferUpdate();
  else await ctx.defer();
  await ctx.serial("poll:" + id, async () => {
    const p = await state(ctx).transact((s) => {
      s.polls[id].closed = true;
      return s.polls[id];
    });
    await ctx.edit(
      ctx.input.kind === "button" ? card(p) : { ...card(p), ephemeral: true },
    );
  });
}
const idOption = {
  name: "poll",
  description: "Poll ID; search by question or ID",
  type: "string" as const,
  required: true,
  maxLength: 100,
  autocomplete: true,
};
export function pollBot() {
  return defineBot({
    name: "Poll workshop",
    recipe: "polls",
    stateSchemas: [pollSchema],
    commands: [
      {
        name: "poll create",
        description: "Create a poll with two to ten answers",
        options: [
          {
            name: "question",
            description: "Poll question",
            type: "string",
            required: true,
            minLength: 1,
            maxLength: 160,
          },
          {
            name: "answers",
            description: "Answers separated with |, e.g. Tea | Coffee",
            type: "string",
            required: true,
            minLength: 3,
            maxLength: 1000,
          },
        ],
        handler: async (ctx) => {
          const question = String(ctx.args.question).trim(),
            options = String(ctx.args.answers)
              .split("|")
              .map((v) => v.trim());
          if (
            !question ||
            options.length < 2 ||
            options.length > 10 ||
            options.some((o) => !o || o.length > 100) ||
            new Set(options.map((o) => o.toLowerCase())).size !== options.length
          )
            throw new Fault(
              "GW_INPUT_INVALID",
              "Provide a question and 2–10 distinct answers, each 1–100 characters.",
              "Separate answers with | and remove duplicate or blank entries.",
            );
          await ctx.defer(false);
          const p = await state(ctx).transact((s) => {
            const id = `poll-${s.nextId++}`;
            const p: Poll = {
              id,
              question,
              owner: ctx.input.actor.id,
              options,
              votes: {},
              closed: false,
            };
            s.polls[id] = p;
            return p;
          });
          await ctx.effect("poll.created", { pollId: p.id });
          await ctx.edit(card(p));
        },
      },
      {
        name: "poll show",
        description: "Show a current poll card",
        options: [idOption],
        autocomplete: suggest,
        handler: async (ctx) => {
          await ctx.reply(card(get(ctx, String(ctx.args.poll))));
        },
      },
      {
        name: "poll vote",
        description: "Vote or change your answer",
        options: [
          idOption,
          {
            name: "answer",
            description: "Answer number (autocomplete shows labels)",
            type: "integer",
            required: true,
            min: 1,
            max: 10,
            autocomplete: true,
          },
        ],
        autocomplete: suggest,
        handler: async (ctx) =>
          vote(ctx, String(ctx.args.poll), Number(ctx.args.answer) - 1),
      },
      {
        name: "poll close",
        description: "Close a poll and retain its votes",
        options: [idOption],
        autocomplete: suggest,
        handler: async (ctx) => close(ctx, String(ctx.args.poll)),
      },
    ],
    routes: [
      {
        kind: "select",
        prefix: "poll:vote:",
        handler: async (ctx) => {
          const selected = ctx.input.values;
          if (
            !selected ||
            selected.length !== 1 ||
            !/^[0-9]$/.test(selected[0])
          )
            throw new Fault(
              "GW_INPUT_INVALID",
              "Choose one valid poll answer.",
              "Validate a single select value before interpreting it.",
            );
          await vote(
            ctx,
            ctx.input.name.slice("poll:vote:".length),
            Number(selected[0]),
          );
        },
      },
      {
        kind: "button",
        prefix: "poll:close:",
        handler: async (ctx) =>
          close(ctx, ctx.input.name.slice("poll:close:".length)),
      },
    ],
  });
}

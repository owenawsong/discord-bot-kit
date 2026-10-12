import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { servePlayground } from "../src/server.js";
import { ticketBot } from "../src/recipes.js";
import { signupBot } from "../src/signups.js";
import { pollBot } from "../src/polls.js";
import { defineBot } from "../src/core.js";
import { defineNamespace } from "../src/namespaces.js";
import { replayEvidence } from "../src/workflow.js";

test("bounded session history advances its replay checkpoint and serializes interactive requests", async () => {
  const bot = defineBot({
    name: "History counter",
    stateSchemas: [
      defineNamespace({
        name: "counter",
        version: 1,
        initial: { n: 0 },
        validate: (v) => Number.isSafeInteger((v as { n: number })?.n),
      }),
    ],
    commands: [
      {
        name: "count",
        description: "Increment",
        handler: async (ctx) => {
          await ctx.defer();
          await ctx.state<{ n: number }>("counter").transact((draft) => {
            draft.n++;
          });
          await ctx.edit({ content: "Counted" });
        },
      },
    ],
    routes: [],
  });
  const server = await servePlayground(bot, { port: 0 });
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const session = (await (await fetch(url + "/api/session")).json()) as {
      session: string;
    };
    for (let batch = 0; batch < 11; batch++)
      await Promise.all(
        Array.from({ length: 10 }, () =>
          fetch(url + "/api/run", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Guildwright-Session": session.session,
            },
            body: JSON.stringify({ name: "count" }),
          }),
        ),
      );
    const evidence = (await (await fetch(url + "/api/evidence")).json()) as any;
    assert.equal(evidence.executions.length, 100);
    assert.equal(
      evidence.initialState.namespaces.counter.guilds["workshop-guild"].n,
      10,
    );
    assert.equal(
      evidence.executions[0].state.namespaces.counter.guilds["workshop-guild"]
        .n,
      11,
    );
    const replay = await replayEvidence(bot, evidence);
    assert("state" in replay);
    assert.equal(
      (
        replay.state.namespaces.counter.guilds["workshop-guild"] as {
          n: number;
        }
      ).n,
      110,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});
test("local API protects mutations and runs real handlers", async () => {
  const server = await servePlayground(ticketBot(), { port: 0 });
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<!doctype html>/i);
    assert.match(
      page.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    const session = (await (await fetch(url + "/api/session")).json()) as {
      session: string;
    };
    assert.equal(
      (
        await fetch(url + "/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "ping" }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + "/api/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Guildwright-Session": session.session,
            Origin: "https://untrusted.example",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    const result = (await (
      await fetch(url + "/api/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Guildwright-Session": session.session,
        },
        body: JSON.stringify({ name: "ping" }),
      })
    ).json()) as { events: unknown[] };
    assert.equal(result.events.length, 1);
    assert.equal(
      (
        await fetch(url + "/api/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Guildwright-Session": session.session,
          },
          body: JSON.stringify({ name: "x", actor: "attacker" }),
        })
      ).status,
      400,
    );
    assert.equal((await fetch(url + "/../../package.json")).status, 404);
  } finally {
    server.close();
    await once(server, "close");
  }
});
test("custom scenario, autocomplete, evidence and replay are isolated from the interactive session", async () => {
  const server = await servePlayground(pollBot(), { port: 0 });
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const session = (await (await fetch(url + "/api/session")).json()) as any;
    assert.equal(session.stateSchemas[0].name, "polls");
    assert.equal(session.routes.length, 2);
    const request = (path: string, data: unknown) =>
      fetch(url + "/api/" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Guildwright-Session": session.session,
        },
        body: JSON.stringify(data),
      });
    const scenario = (await (
      await request("scenario", {
        scenario: {
          name: "One poll",
          steps: [
            {
              name: "poll create",
              args: { question: "Q?", answers: "A | B" },
              expect: { clean: true },
            },
          ],
        },
      })
    ).json()) as any;
    assert.equal(scenario.passed, true);
    const untouched = (await (await fetch(url + "/api/session")).json()) as any;
    assert.deepEqual(untouched.state.namespaces, {});
    await request("run", {
      name: "poll create",
      args: { question: "Interactive?", answers: "A | B" },
    });
    const suggestions = (await (
      await request("autocomplete", {
        name: "poll show",
        option: "poll",
        value: "Interactive",
      })
    ).json()) as any;
    assert.equal(suggestions.choices[0].value, "poll-1");
    const evidence = (await (await fetch(url + "/api/evidence")).json()) as any;
    assert.equal(evidence.session, undefined);
    assert.equal(evidence.format, "guildwright.session");
    assert.equal(evidence.executions.length, 1);
    const replay = (await (
      await request("replay", { evidence })
    ).json()) as any;
    assert.equal(replay.environment, "isolated-local-replay");
    assert.equal(
      replay.state.namespaces.polls.guilds["workshop-guild"].nextId,
      2,
    );
    assert.equal(
      ((await (await fetch(url + "/api/session")).json()) as any).state
        .namespaces.polls.guilds["workshop-guild"].nextId,
      2,
    );
    const reset = (await (await request("reset", {})).json()) as any;
    assert.deepEqual(reset.state.namespaces, {});
  } finally {
    server.close();
    await once(server, "close");
  }
});
test("signup HTTP arguments reach shared handlers and reset clears event state", async () => {
  const server = await servePlayground(signupBot(), { port: 0 });
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const session = (await (await fetch(url + "/api/session")).json()) as {
      session: string;
    };
    const request = (path: string, data: unknown) =>
      fetch(url + "/api/" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Guildwright-Session": session.session,
        },
        body: JSON.stringify(data),
      });
    const create = (await (
      await request("run", {
        name: "event-create",
        actor: "moderator",
        args: { title: "HTTP event", capacity: 2 },
      })
    ).json()) as any;
    assert.equal(create.state.events.length, 1);
    assert.equal(create.state.events[0].capacity, 2);
    const reset = (await (await request("reset", {})).json()) as any;
    assert.deepEqual(reset.state.events, []);
    assert.equal(reset.state.nextEvent, 1);
  } finally {
    server.close();
    await once(server, "close");
  }
});

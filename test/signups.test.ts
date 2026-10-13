import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signupBot } from "../src/signups.js";
import { Simulator, actors, input } from "../src/simulate.js";
import { Store } from "../src/store.js";
import { runScenarios } from "../src/scenarios.js";
import { runScenario } from "../src/workflow.js";
test("all signup recipe checks pass", async () => {
  const results = await runScenarios(signupBot());
  assert.equal(results.length, 14);
  assert.deepEqual(
    results.filter((r) => !r.passed),
    [],
  );
});
test("signup roster survives restart and old button IDs still resolve", async () => {
  const dir = await mkdtemp(join(tmpdir(), "discord-bot-kit-events-"));
  try {
    const path = join(dir, "state.json");
    const store = new Store(path);
    const sim = new Simulator(signupBot(), store);
    await sim.run(
      input("event-create", {
        actor: actors.moderator,
        args: { title: "Restart event", capacity: 2 },
      }),
    );
    await sim.run(input("event-join", { args: { event: "event-1" } }));
    const restored = new Store(path);
    await restored.load();
    const next = new Simulator(signupBot(), restored);
    const r = await next.run(
      input("event:join:event-1", { kind: "button", actor: actors.stranger }),
    );
    assert.equal(r.diagnostics.length, 0);
    assert.deepEqual(r.state.events[0].participants, [
      actors.member.id,
      actors.stranger.id,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("older ticket-only v1 state migrates without losing tickets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "discord-bot-kit-migrate-"));
  try {
    const path = join(dir, "state.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        tickets: [
          {
            id: "ticket-1",
            guildId: "g",
            owner: "u",
            topic: "keep me",
            status: "open",
            channelId: "c",
            createdAt: "2026-10-12",
          },
        ],
        nextTicket: 2,
      }),
    );
    const store = new Store(path);
    await store.load();
    assert.equal(store.snapshot().tickets[0].topic, "keep me");
    assert.deepEqual(store.snapshot().events, []);
    assert.equal(store.snapshot().nextEvent, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("closed rosters reject leave, repeat close is harmless and another guild cannot join", async () => {
  const sim = new Simulator(signupBot());
  await sim.run(
    input("event-create", {
      actor: actors.moderator,
      args: { title: "Closed event", capacity: 2 },
    }),
  );
  await sim.run(input("event-join", { args: { event: "event-1" } }));
  await sim.run(
    input("event-close", {
      actor: actors.moderator,
      args: { event: "event-1" },
    }),
  );
  const leave = await sim.run(
    input("event-leave", { args: { event: "event-1" } }),
  );
  assert.equal(leave.diagnostics[0].code, "GW_EVENT_CLOSED");
  assert.equal(leave.state.events[0].participants.length, 1);
  const repeat = await sim.run(
    input("event-close", {
      actor: actors.moderator,
      args: { event: "event-1" },
    }),
  );
  assert(!repeat.events.some((e) => e.type === "effect"));
  const outsider = await sim.run(
    input("event:join:event-1", { kind: "button", guildId: "other" }),
  );
  assert.equal(outsider.diagnostics[0].code, "GW_EVENT_MISSING");
});
test("scenario assertions inspect an explicit event roster", async () => {
  const r = await runScenario(signupBot(), {
    name: "Roster assertion",
    steps: [
      {
        name: "event-create",
        actor: "moderator",
        args: { title: "Test", capacity: 1 },
        expect: {
          eventCount: 1,
          eventId: "event-1",
          participantCount: 0,
          eventStatus: "open",
          clean: true,
        },
      },
      {
        name: "event-join",
        args: { event: "event-1" },
        expect: { eventId: "event-1", participantCount: 1, clean: true },
      },
    ],
  });
  assert.equal(r.passed, true);
});
test("deferUpdate cannot be used by a slash command", async () => {
  const bot = signupBot();
  bot.commands.push({
    name: "wrong-update",
    description: "Fixture",
    handler: async (c) => c.deferUpdate(),
  });
  const r = await new Simulator(bot).run(input("wrong-update"));
  assert.equal(r.diagnostics[0].code, "GW_UPDATE_CONTEXT");
});
test("long event titles are paginated below Discord content limits", async () => {
  const sim = new Simulator(signupBot());
  for (let i = 0; i < 20; i++)
    await sim.run(
      input("event-create", {
        actor: actors.moderator,
        args: { title: "t".repeat(120), capacity: 1000 },
      }),
    );
  const first = await sim.run(input("event-list"));
  assert.equal(first.diagnostics.length, 0);
  const content = (first.events[0].data as any).content;
  assert(content.length < 2000);
  assert.match(content, /page 1\/4/);
  const last = await sim.run(input("event-list", { args: { page: 4 } }));
  assert.equal(last.diagnostics.length, 0);
  assert.match((last.events[0].data as any).content, /page 4\/4/);
});
test("concurrent membership edits stay in commit order even with slow transport", async () => {
  const store = new Store();
  const first = new Simulator(signupBot(), store),
    second = new Simulator(signupBot(), store);
  await first.run(
    input("event-create", {
      actor: actors.moderator,
      args: { title: "Ordered updates", capacity: 3 },
    }),
  );
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const reached = new Promise<void>((r) => (arrived = r));
  const edits: string[] = [];
  first.port.send = async (type, data) => {
    if (type === "edit") {
      arrived();
      await gate;
      edits.push((data as any).content);
    }
  };
  second.port.send = async (type, data) => {
    if (type === "edit") edits.push((data as any).content);
  };
  const a = first.run(input("event:join:event-1", { kind: "button" }));
  await reached;
  const b = second.run(
    input("event:join:event-1", { kind: "button", actor: actors.stranger }),
  );
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(store.snapshot().events[0].participants.length, 1);
  assert.equal(edits.length, 0);
  release();
  await Promise.all([a, b]);
  assert.match(edits[0], /1\/3/);
  assert.match(edits[1], /2\/3/);
});

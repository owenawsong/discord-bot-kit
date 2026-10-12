import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pollBot } from "../src/polls.js";
import {
  runScenario,
  replayEvidence,
  pointer,
  type Scenario,
} from "../src/workflow.js";
import { ticketBot } from "../src/recipes.js";
import { defineBot } from "../src/core.js";
import { defineNamespace } from "../src/namespaces.js";
import { Simulator, input } from "../src/simulate.js";
test("poll example captures IDs, replays a duplicate and asserts parallel final state", async () => {
  const scenario = JSON.parse(
    await readFile(
      new URL("../../examples/polls/scenario.json", import.meta.url),
      "utf8",
    ),
  ) as Scenario;
  const report = await runScenario(pollBot(), scenario);
  assert.equal(report.passed, true);
  assert.equal(report.batches.length, 1);
  assert.equal(report.captures.voted.input.name, "poll:vote:poll-1");
  assert.equal(report.bot.fingerprint.length, 64);
  assert.equal(report.scenarioHash.length, 64);
});
test("ambiguous create fault leaves one remote fixture and replay does not duplicate it", async () => {
  const report = await runScenario(ticketBot(), {
    name: "Ambiguous create",
    steps: [
      {
        name: "ticket:create",
        kind: "modal",
        fields: { topic: "Help" },
        faults: { createTicket: "after" },
        saveAs: "failed",
        expect: {
          code: "GW_PROVISION_INCOMPLETE",
          exact: {
            "/state/tickets/0/status": "provisioning",
            "/simulation/channels/channel-ticket-1/id": "ticket-1",
          },
        },
      },
      {
        replay: "failed",
        expect: {
          clean: true,
          ticketCount: 1,
          exact: { "/simulation/channels/channel-ticket-1/id": "ticket-1" },
        },
      },
    ],
  });
  assert.equal(report.passed, true);
  assert.equal(
    Object.keys(report.steps[1].result.simulation!.channels).length,
    1,
  );
});
test("exact assertions report concrete mismatches and malformed absent paths cannot pass", async () => {
  const report = await runScenario(ticketBot(), {
    name: "Mismatch",
    steps: [{ name: "ping", expect: { exact: { "/state/nextTicket": 10 } } }],
  });
  assert.equal(report.passed, false);
  assert.match(report.steps[0].errors[0], /expected 10, got 1/);
  await assert.rejects(
    runScenario(ticketBot(), {
      name: "Bad pointer",
      steps: [{ name: "ping", expect: { absent: ["/state/~x"] } }],
    }),
    /Invalid JSON pointer/,
  );
  assert.throws(() => pointer({}, "/~2"), /Invalid JSON pointer/);
});
test("parallel batches exercise generic state rather than only recipe-specific fields", async () => {
  const schema = defineNamespace({
    name: "counter",
    version: 1,
    initial: { n: 0 },
    validate: (v) => Number.isSafeInteger((v as any)?.n),
  });
  const bot = defineBot({
    name: "Counter",
    stateSchemas: [schema],
    commands: [
      {
        name: "count",
        description: "Count",
        handler: async (ctx) => {
          await ctx.defer();
          await ctx.state<{ n: number }>("counter").transact((s) => {
            s.n++;
          });
          await ctx.edit({ content: "Counted" });
        },
      },
    ],
    routes: [],
  });
  const report = await runScenario(bot, {
    name: "Parallel counter",
    steps: [
      {
        label: "Ten updates",
        parallel: Array.from({ length: 10 }, () => ({
          name: "count",
          expect: { clean: true },
        })),
        expect: {
          exact: { "/state/namespaces/counter/guilds/workshop-guild/n": 10 },
          clean: true,
        },
      },
    ],
  });
  assert.equal(report.passed, true);
  assert.equal(report.steps.length, 10);
});
test("captures use own JSON paths and disallow undefined references", async () => {
  await assert.rejects(
    runScenario(ticketBot(), {
      name: "Missing ref",
      steps: [
        { name: "ping", saveAs: "hello", expect: { clean: true } },
        { name: "${hello#/constructor/name}", expect: { clean: true } },
      ],
    }),
    /does not exist/,
  );
});
test("session replay restores a validated initial checkpoint before applying inputs", async () => {
  const sim = new Simulator(pollBot());
  await sim.run(
    input("poll create", {
      args: { question: "Existing poll?", answers: "A | B" },
    }),
  );
  const initialState = sim.store.snapshot();
  const voted = await sim.run(
    input("poll vote", { args: { poll: "poll-1", answer: 2 } }),
  );
  const replay = await replayEvidence(pollBot(), {
    format: "guildwright.session",
    version: 1,
    initialState,
    executions: [voted],
  });
  assert("state" in replay);
  assert.equal(
    (replay.state.namespaces.polls.guilds["workshop-guild"] as any).polls[
      "poll-1"
    ].votes["member-1"],
    1,
  );
  assert.equal(
    (initialState.namespaces.polls.guilds["workshop-guild"] as any).polls[
      "poll-1"
    ].votes["member-1"],
    undefined,
  );
});
test("session replay carries fault fixtures and rejects malformed evidence versions", async () => {
  const sim = new Simulator(ticketBot());
  const failure = await sim.run(
    input("ticket:create", { kind: "modal", fields: { topic: "Ambiguous" } }),
    { createTicket: "after" },
  );
  const replay = await replayEvidence(ticketBot(), { executions: [failure] });
  assert("results" in replay);
  assert.equal(
    replay.results[0].diagnostics[0].code,
    "GW_PROVISION_INCOMPLETE",
  );
  await assert.rejects(
    replayEvidence(ticketBot(), {
      format: "guildwright.session",
      version: 99,
      executions: [failure],
    }),
    /Unsupported/,
  );
});

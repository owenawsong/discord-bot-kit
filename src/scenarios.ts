import { actors, input, Simulator } from "./simulate.js";
import { ticketBot } from "./recipes.js";
import { defineBot } from "./core.js";
import type { Bot } from "./types.js";
import { runSignupScenarios } from "./signup-scenarios.js";
import { runPollScenarios } from "./poll-scenarios.js";
export interface ScenarioResult {
  name: string;
  passed: boolean;
  detail: string;
}
export async function runScenarios(
  bot: Bot = ticketBot(),
): Promise<ScenarioResult[]> {
  if (bot.recipe === "signups") return runSignupScenarios(bot);
  if (bot.recipe === "polls") return runPollScenarios(bot);
  if (bot.recipe !== "tickets")
    throw new Error(
      "This custom bot has no bundled recipe suite. Use test --scenario path/to/scenario.json.",
    );
  const results: ScenarioResult[] = [];
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ name, passed: true, detail: "Passed" });
    } catch (e) {
      results.push({
        name,
        passed: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  };
  const assert = (value: unknown, message: string) => {
    if (!value) throw new Error(message);
  };
  const sim = new Simulator(bot);
  await check("Slash command opens a modal", async () => {
    const r = await sim.run(input("ticket"));
    assert(
      r.events.some((e) => e.type === "modal"),
      "Expected a modal",
    );
    assert(!r.diagnostics.length, "Unexpected diagnostic");
  });
  await check("Modal creates one durable ticket", async () => {
    const r = await sim.run(
      input("ticket:create", {
        kind: "modal",
        fields: { topic: "Cannot access the docs" },
      }),
    );
    assert(
      r.state.tickets.length === 1 && r.state.tickets[0].status === "open",
      "Expected one open ticket",
    );
  });
  await check(
    "Concurrent submissions do not create duplicate channels",
    async () => {
      const fresh = new Simulator(bot);
      await Promise.all(
        Array.from({ length: 8 }, () =>
          fresh.run(
            input("ticket:create", {
              kind: "modal",
              fields: { topic: "Help" },
            }),
          ),
        ),
      );
      assert(
        fresh.store.snapshot().tickets.length === 1 &&
          fresh.channels.size === 1,
        "Duplicate ticket or channel detected",
      );
    },
  );
  await check("Another member cannot close the ticket", async () => {
    const r = await sim.run(
      input("ticket:close:ticket-1", {
        kind: "button",
        actor: actors.stranger,
      }),
    );
    assert(
      r.diagnostics.some((d) => d.code === "GW_PERMISSION_DENIED"),
      "Expected permission denial",
    );
    assert(r.state.tickets[0].status === "open", "Unauthorized state mutation");
  });
  await check("Moderator can close the ticket", async () => {
    const r = await sim.run(
      input("ticket:close:ticket-1", {
        kind: "button",
        actor: actors.moderator,
      }),
    );
    assert(r.state.tickets[0].status === "closed", "Expected closed state");
  });
  await check("Repeated close is harmless", async () => {
    const r = await sim.run(input("ticket:close:ticket-1", { kind: "button" }));
    assert(
      r.diagnostics.length === 0,
      "Repeated close should acknowledge safely",
    );
    assert(
      !r.events.some((e) => e.type === "effect"),
      "Repeated close caused another side effect",
    );
  });
  await check("Commands reject direct messages", async () => {
    const r = await sim.run(input("ticket", { guildId: undefined }));
    assert(
      r.diagnostics.some((d) => d.code === "GW_GUILD_REQUIRED"),
      "Expected DM rejection",
    );
  });
  await check("Moderation commands enforce permissions", async () => {
    const r = await sim.run(input("audit"));
    assert(
      r.diagnostics.some((d) => d.code === "GW_PERMISSION_DENIED"),
      "Member reached moderator command",
    );
  });
  await check("Select values are validated", async () => {
    const r = await sim.run(
      input("preferences:choose", { kind: "select", values: ["invalid"] }),
    );
    assert(
      r.diagnostics.some((d) => d.code === "GW_INPUT_INVALID"),
      "Invalid select value accepted",
    );
  });
  await check(
    "Late acknowledgement produces a precise diagnostic",
    async () => {
      const r = await sim.run(input("ping", { ageMs: 3001 }));
      assert(
        r.diagnostics.some((d) => d.code === "GW_ACK_TIMEOUT"),
        "Expected timeout diagnostic",
      );
    },
  );
  await check("Double acknowledgement is detected", async () => {
    const broken = defineBot({
      name: "Deliberate fault",
      routes: [],
      commands: [
        {
          name: "bad",
          description: "Fixture",
          handler: async (c) => {
            await c.reply({ content: "First" });
            await c.reply({ content: "Second" });
          },
        },
      ],
    });
    const r = await new Simulator(broken).run(input("bad"));
    assert(
      r.diagnostics.some((d) => d.code === "GW_DOUBLE_ACK"),
      "Expected double acknowledgement diagnostic",
    );
  });
  return results;
}

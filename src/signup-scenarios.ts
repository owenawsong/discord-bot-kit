import { actors, input, Simulator } from "./simulate.js";
import type { Bot } from "./types.js";
import type { ScenarioResult } from "./scenarios.js";
export async function runSignupScenarios(bot: Bot): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const assert = (value: unknown, message: string) => {
    if (!value) throw new Error(message);
  };
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
  const sim = new Simulator(bot);
  await check("Members cannot create managed events", async () => {
    const r = await sim.run(
      input("event-create", { args: { title: "Reading group", capacity: 1 } }),
    );
    assert(
      r.diagnostics.some((d) => d.code === "GW_PERMISSION_DENIED"),
      "Member created an event",
    );
  });
  await check("Required slash options are enforced", async () => {
    const r = await sim.run(
      input("event-create", {
        actor: actors.moderator,
        args: { title: "Reading group" },
      }),
    );
    assert(
      r.diagnostics.some((d) => d.code === "GW_ARGUMENT_REQUIRED"),
      "Missing capacity accepted",
    );
  });
  await check("Capacity bounds reject invalid values", async () => {
    const r = await sim.run(
      input("event-create", {
        actor: actors.moderator,
        args: { title: "Reading group", capacity: 0 },
      }),
    );
    assert(
      r.diagnostics.some((d) => d.code === "GW_ARGUMENT_RANGE"),
      "Zero capacity accepted",
    );
  });
  await check("Manager creates a durable public signup card", async () => {
    const r = await sim.run(
      input("event-create", {
        actor: actors.moderator,
        args: { title: "Reading group", capacity: 1 },
      }),
    );
    assert(
      r.state.events.length === 1 && r.state.events[0].capacity === 1,
      "Expected one event",
    );
    assert(
      r.events.some((e) => e.type === "edit"),
      "Expected signup card",
    );
  });
  await check("Member can join through a component", async () => {
    const r = await sim.run(input("event:join:event-1", { kind: "button" }));
    assert(
      r.state.events[0].participants.length === 1,
      "Join was not recorded",
    );
    assert(
      r.events.some((e) => e.type === "deferUpdate"),
      "Button did not acknowledge its source message",
    );
  });
  await check("Repeated joins do not duplicate a participant", async () => {
    const r = await sim.run(input("event:join:event-1", { kind: "button" }));
    assert(
      r.state.events[0].participants.length === 1 &&
        !r.events.some((e) => e.type === "effect"),
      "Repeated join changed membership",
    );
  });
  await check("Another member cannot exceed capacity", async () => {
    const r = await sim.run(
      input("event:join:event-1", { kind: "button", actor: actors.stranger }),
    );
    assert(
      r.diagnostics.some((d) => d.code === "GW_EVENT_FULL"),
      "Capacity exceeded",
    );
    assert(r.state.events[0].participants.length === 1, "Full event mutated");
  });
  await check("Leaving releases a place", async () => {
    const r = await sim.run(
      input("event-leave", { args: { event: "event-1" } }),
    );
    assert(
      r.state.events[0].participants.length === 0,
      "Leave did not release a place",
    );
  });
  await check("A released place can be filled", async () => {
    const r = await sim.run(
      input("event-join", {
        actor: actors.stranger,
        args: { event: "event-1" },
      }),
    );
    assert(
      r.state.events[0].participants[0] === actors.stranger.id,
      "New member did not get the place",
    );
  });
  await check("Another member cannot close signups", async () => {
    const r = await sim.run(input("event:close:event-1", { kind: "button" }));
    assert(
      r.diagnostics.some((d) => d.code === "GW_PERMISSION_DENIED") &&
        r.state.events[0].status === "open",
      "Unauthorized close",
    );
  });
  await check("Manager can close and retain the roster", async () => {
    const r = await sim.run(
      input("event-close", {
        actor: actors.moderator,
        args: { event: "event-1" },
      }),
    );
    assert(
      r.state.events[0].status === "closed" &&
        r.state.events[0].participants.length === 1,
      "Closed roster lost",
    );
  });
  await check("Closed events reject stale join buttons", async () => {
    const r = await sim.run(input("event:join:event-1", { kind: "button" }));
    assert(
      r.diagnostics.some((d) => d.code === "GW_EVENT_CLOSED"),
      "Closed event accepted a join",
    );
  });
  await check("Event lookups are scoped to the current guild", async () => {
    const r = await sim.run(
      input("event-show", {
        guildId: "other-guild",
        args: { event: "event-1" },
      }),
    );
    assert(
      r.diagnostics.some((d) => d.code === "GW_EVENT_MISSING"),
      "Cross-guild lookup succeeded",
    );
  });
  await check("Concurrent joins respect capacity", async () => {
    const fresh = new Simulator(bot);
    await fresh.run(
      input("event-create", {
        actor: actors.moderator,
        args: { title: "Capacity race", capacity: 3 },
      }),
    );
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, n) =>
        fresh.run(
          input("event:join:event-1", {
            kind: "button",
            actor: {
              id: `racer-${n}`,
              name: `Racer ${n}`,
              permissions: ["ViewChannel", "SendMessages"],
            },
          }),
        ),
      ),
    );
    const roster = fresh.store.snapshot().events[0].participants;
    assert(
      roster.length === 3 && new Set(roster).size === 3,
      "Concurrent capacity mismatch",
    );
    assert(
      results.filter((r) =>
        r.diagnostics.some((d) => d.code === "GW_EVENT_FULL"),
      ).length === 27,
      "Expected 27 full results",
    );
  });
  return results;
}

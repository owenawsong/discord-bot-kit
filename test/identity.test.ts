import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection, ChannelType, type Guild } from "discord.js";
import { defaultStatePath } from "../src/identity.js";
import { replayEvidence } from "../src/workflow.js";
import { ticketBot } from "../src/recipes.js";
import { input } from "../src/simulate.js";
import { reconcile } from "../src/discord.js";
import { Store } from "../src/store.js";

test("renamed state path preserves existing legacy deployments and explicit configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "discord-bot-kit-rename-")),
    before = process.cwd();
  try {
    process.chdir(dir);
    assert.equal(defaultStatePath({}), ".discord-bot-kit/live-state.json");
    await mkdir(".guildwright");
    await writeFile(".guildwright/live-state.json", "{}");
    assert.equal(defaultStatePath({}), ".guildwright/live-state.json");
    assert.equal(
      defaultStatePath({ GUILDWRIGHT_STATE: "old-custom.json" }),
      "old-custom.json",
    );
    assert.equal(
      defaultStatePath({
        GUILDWRIGHT_STATE: "old.json",
        DISCORD_BOT_KIT_STATE: "new.json",
      }),
      "new.json",
    );
    await mkdir(".discord-bot-kit");
    await writeFile(".discord-bot-kit/live-state.json", "{}");
    assert.equal(defaultStatePath({}), ".discord-bot-kit/live-state.json");
  } finally {
    process.chdir(before);
    await rm(dir, { recursive: true, force: true });
  }
});

test("old Guildwright session and scenario evidence still replay with the renamed toolkit", async () => {
  const session = await replayEvidence(ticketBot(), {
    format: "guildwright.session",
    version: 1,
    executions: [{ input: input("ping") }],
  });
  assert("results" in session);
  assert.equal(session.results[0].diagnostics.length, 0);
  const scenario = await replayEvidence(ticketBot(), {
    format: "guildwright.scenario",
    version: 1,
    scenario: {
      name: "Legacy greeting",
      steps: [{ name: "ping", expect: { clean: true } }],
    },
  });
  assert("passed" in scenario);
  assert.equal(scenario.passed, true);
  assert.equal(scenario.format, "discord-bot-kit.scenario");
});

test("channel recovery accepts a complete legacy marker and refuses ambiguous mixed identities", async () => {
  const store = new Store();
  await store.mutate((s) => {
    s.nextTicket = 3;
    s.tickets = [1, 2].map((n) => ({
      id: `ticket-${n}`,
      guildId: "guild",
      owner: "owner",
      topic: "Help",
      status: "provisioning",
      createdAt: "2026-10-12",
    }));
  });
  const channels = new Collection<string, any>([
    [
      "one",
      {
        id: "one",
        type: ChannelType.GuildText,
        topic: "guildwright:guild:ticket-1:owner",
      },
    ],
    [
      "two-old",
      {
        id: "two-old",
        type: ChannelType.GuildText,
        topic: "guildwright:guild:ticket-2:owner",
      },
    ],
    [
      "two-new",
      {
        id: "two-new",
        type: ChannelType.GuildText,
        topic: "discord-bot-kit:guild:ticket-2:owner",
      },
    ],
  ]);
  const guild = {
    id: "guild",
    channels: { fetch: async () => channels },
  } as unknown as Guild;
  const report = await reconcile(guild, store);
  assert.equal(store.snapshot().tickets[0].channelId, "one");
  assert.equal(store.snapshot().tickets[1].status, "provisioning");
  assert.match(report[1].action, /2 matching channels/);
});

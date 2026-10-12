import test from "node:test";
import assert from "node:assert/strict";
import { Collection, ChannelType, OverwriteType, type Guild } from "discord.js";
import { reconcile } from "../src/discord.js";
import { Store } from "../src/store.js";
test("recovery specifies historical member overwrite type and continues after a damaged ticket", async () => {
  const store = new Store();
  await store.mutate((s) => {
    s.nextTicket = 3;
    s.tickets = [1, 2].map((n) => ({
      id: `ticket-${n}`,
      guildId: "guild",
      owner: `uncached-owner-${n}`,
      topic: "Topic",
      channelId: `channel-${n}`,
      status: "closing",
      createdAt: "2026-10-12",
    }));
  });
  let options: unknown;
  const channels = new Collection<string, any>([
    [
      "channel-1",
      { id: "channel-1", type: ChannelType.GuildText, topic: "unrelated" },
    ],
    [
      "channel-2",
      {
        id: "channel-2",
        type: ChannelType.GuildText,
        topic: "guildwright:guild:ticket-2:uncached-owner-2",
        permissionOverwrites: {
          edit: async (_owner: string, _values: unknown, opts: unknown) => {
            options = opts;
          },
        },
        setName: async () => {},
      },
    ],
  ]);
  const guild = {
    id: "guild",
    channels: {
      fetch: async (id?: string) => (id ? channels.get(id) : channels),
    },
    members: { fetchMe: async () => ({ permissions: { has: () => true } }) },
  } as unknown as Guild;
  const report = await reconcile(guild, store);
  assert.equal(report.length, 2);
  assert.match(report[0].action, /paused/);
  assert.equal(store.snapshot().tickets[0].status, "closing");
  assert.equal(store.snapshot().tickets[1].status, "closed");
  assert.equal((options as any).type, OverwriteType.Member);
});

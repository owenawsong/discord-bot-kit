import test from "node:test";
import assert from "node:assert/strict";
import {
  discordMessage,
  commandManifest,
  interactionCommand,
} from "../src/discord.js";
import { validateMessage } from "../src/messages.js";
import { defineBot } from "../src/core.js";
import { pollBot } from "../src/polls.js";
import { Simulator, input } from "../src/simulate.js";
import { runAutocomplete } from "../src/autocomplete.js";
test("embed-only messages serialize correctly without enabling mentions", () => {
  const message = discordMessage({
    embeds: [
      {
        title: "Results",
        description: "A real result",
        color: 0xdafa73,
        fields: [{ name: "A", value: "2", inline: true }],
        footer: { text: "Snapshot" },
      },
    ],
  });
  assert.equal(message.content, undefined);
  assert.equal(message.embeds[0].toJSON().fields![0].value, "2");
  assert.deepEqual(message.allowedMentions.parse, []);
});
test("embeds enforce aggregate limits, field limits and URL protocols", () => {
  assert.throws(
    () =>
      validateMessage({
        embeds: [
          { description: "a".repeat(3001) },
          { description: "b".repeat(3000) },
        ],
      }),
    /6000/,
  );
  assert.throws(
    () =>
      validateMessage({
        embeds: [{ fields: [{ name: "A", value: "x".repeat(1025) }] }],
      }),
    /bounds/,
  );
  assert.throws(
    () => validateMessage({ embeds: [{ url: "javascript:alert(1)" }] }),
    /HTTP/,
  );
});
test("subcommands and nested groups produce real Discord manifests", () => {
  const bot = defineBot({
    name: "Grouped",
    commands: [
      {
        name: "project add",
        description: "Add",
        handler: async (c) => c.reply({ content: "Added" }),
      },
      {
        name: "project labels add",
        description: "Add label",
        handler: async (c) => c.reply({ content: "Labeled" }),
      },
    ],
    routes: [],
  });
  const manifest = commandManifest(bot);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].name, "project");
  const options = manifest[0].options as any[];
  assert.equal(options[0].type, 1);
  assert.equal(options[1].type, 2);
  assert.equal(options[1].options[0].name, "add");
  assert.throws(
    () =>
      defineBot({
        ...bot,
        commands: [
          ...bot.commands,
          { name: "project", description: "Conflict", handler: async () => {} },
        ],
      }),
    /also be a command group/,
  );
});
test("real interaction data unwraps nested leaves and preserves false/zero", () => {
  const result = interactionCommand({
    commandName: "project",
    options: {
      getSubcommandGroup: () => "labels",
      getSubcommand: () => "add",
      data: [
        {
          name: "labels",
          options: [
            {
              name: "add",
              options: [
                { name: "quiet", value: false },
                { name: "count", value: 0 },
              ],
            },
          ],
        },
      ],
    },
  });
  assert.equal(result.name, "project labels add");
  assert.deepEqual(result.args, { quiet: false, count: 0 });
});
test("poll autocomplete reads its guild namespace and suggestions preserve types", async () => {
  const bot = pollBot(),
    sim = new Simulator(bot);
  await sim.run(
    input("poll create", {
      args: { question: "Which genre?", answers: "Jazz | Ambient" },
    }),
  );
  const actor = input("unused").actor;
  const ids = await runAutocomplete(
    bot,
    {
      name: "poll show",
      option: "poll",
      value: "genre",
      actor,
      guildId: "workshop-guild",
    },
    sim.store,
  );
  assert.equal(ids.choices[0].value, "poll-1");
  const answers = await runAutocomplete(
    bot,
    {
      name: "poll vote",
      option: "answer",
      value: "1",
      args: { poll: "poll-1" },
      actor,
      guildId: "workshop-guild",
    },
    sim.store,
  );
  assert.equal(answers.choices[0].value, 1);
  const other = await runAutocomplete(
    bot,
    { name: "poll show", option: "poll", value: "", actor, guildId: "other" },
    sim.store,
  );
  assert.deepEqual(other.choices, []);
});
test("autocomplete rejects missing handlers and expired requests without mutating state", async () => {
  const sim = new Simulator(pollBot()),
    actor = input("unused").actor;
  const expired = await runAutocomplete(
    sim.bot,
    {
      name: "poll show",
      option: "poll",
      value: "",
      actor,
      guildId: "workshop-guild",
      ageMs: 3001,
    },
    sim.store,
  );
  assert.equal(expired.diagnostics[0].code, "GW_ACK_TIMEOUT");
  const unknown = await runAutocomplete(
    sim.bot,
    {
      name: "poll create",
      option: "question",
      value: "",
      actor,
      guildId: "workshop-guild",
    },
    sim.store,
  );
  assert.equal(unknown.diagnostics[0].code, "GW_AUTOCOMPLETE_UNKNOWN");
  assert.deepEqual(sim.store.snapshot().namespaces, {});
});
test("autocomplete checks permissions, output constraints and response timeouts", async () => {
  const bot = defineBot({
    name: "Suggestions",
    commands: [
      {
        name: "pick",
        description: "Pick",
        permission: "ManageGuild",
        options: [
          {
            name: "number",
            description: "A number",
            type: "integer",
            min: 1,
            max: 3,
            autocomplete: true,
          },
        ],
        autocomplete: async () => [{ name: "Too large", value: 9 }],
        handler: async (c) => c.reply({ content: "Picked" }),
      },
    ],
    routes: [],
  });
  const sim = new Simulator(bot);
  const denied = await runAutocomplete(
    bot,
    {
      name: "pick",
      option: "number",
      value: "",
      actor: input("x").actor,
      guildId: "g",
    },
    sim.store,
  );
  assert.equal(denied.diagnostics[0].code, "GW_PERMISSION_DENIED");
  const manager = {
    id: "manager",
    name: "Manager",
    permissions: ["ManageGuild"] as const,
  };
  const bad = await runAutocomplete(
    bot,
    {
      name: "pick",
      option: "number",
      value: "",
      actor: { ...manager, permissions: [...manager.permissions] },
      guildId: "g",
    },
    sim.store,
  );
  assert.equal(bad.diagnostics[0].code, "GW_AUTOCOMPLETE_OUTPUT");
  bot.commands[0].autocomplete = async () =>
    new Promise((r) => setTimeout(() => r([]), 20));
  const slow = await runAutocomplete(
    bot,
    {
      name: "pick",
      option: "number",
      value: "",
      actor: { ...manager, permissions: [...manager.permissions] },
      guildId: "g",
      ageMs: 2499,
    },
    sim.store,
  );
  assert.equal(slow.diagnostics[0].code, "GW_AUTOCOMPLETE_TIMEOUT");
});

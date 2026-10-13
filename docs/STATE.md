# Versioned application state

Discord Bot Kit supports your bot's domain data through registered JSON namespaces. Tickets and signups keep their existing v0.1 schema; new features can declare state without modifying the toolkit.

```js
import { defineBot, defineNamespace } from "@owenawsong/discord-bot-kit";

const counter = defineNamespace({
  name: "counter",
  version: 1,
  initial: { count: 0 },
  validate: (value) =>
    value && Number.isSafeInteger(value.count) && value.count >= 0,
});

export default defineBot({
  name: "Counter bot",
  stateSchemas: [counter],
  routes: [],
  commands: [
    {
      name: "counter add",
      description: "Increase the counter",
      handler: async (ctx) => {
        await ctx.defer();
        const count = await ctx
          .state("counter")
          .transact((draft) => ++draft.count);
        await ctx.edit({ content: `Count: ${count}`, ephemeral: true });
      },
    },
  ],
});
```

## Scope

`ctx.state(name)` defaults to the current guild and rejects DMs. `ctx.state(name, {scope: 'global'})` explicitly selects shared application state. `snapshot()` returns a copy. Mutation uses `transact(draft => result)` for object/array drafts, or `update(current => replacement)` for a scalar or a new root value. Namespace data is stored as:

```json
{
  "namespaces": {
    "counter": {
      "version": 1,
      "guilds": { "123456789012345678": { "count": 7 } }
    }
  }
}
```

An explicit global scope adds `global` beside `guilds`. Reading an unused scope returns its initial default without materializing a record. A successful transaction materializes it. Registered contracts expose namespace name, version and initial value to the CLI, MCP and local UI; validators run in Node, not in the browser.

## Guarantees and boundaries

- Drafts, results, initial defaults and committed snapshots are cloned. Retaining a callback reference cannot mutate committed state later.
- All file-store mutations serialize through one queue. Concurrent updates do not overwrite each other within that process.
- Validators inspect cloned values and must return `true`. Invalid JSON values, cycles, undefined, custom objects and invalid drafts are rejected before writing.
- A scope is capped at 1 MB and 64 nesting levels. The store is for small bot state; large datasets need a database.
- Stored namespace versions must match the registered schema. A mismatch stops loading and leaves the file intact. Back up and explicitly migrate your data before increasing a version; there is no implicit migration.
- Unknown stored namespaces are retained, but handlers cannot access them unless their schemas are registered.
- One process per JSON state file. This is not a distributed database or a cross-process lock.

`ctx.serial(resourceKey, async () => ...)` serializes a resource's commit and subsequent message edit. Use it when a slow earlier edit could overwrite a newer count. It scopes keys to the current guild and process. It is not an authorization check and does not make remote effects transactional.

Never perform network effects inside a state transaction. Reserve state, perform the effect, then record its outcome; ambiguous network failures require reconciliation. The included ticket workflow demonstrates this. Polls demonstrate a domain implemented entirely through namespaces.

## Inspect and recover

`discord-bot-kit doctor --bot bot.mjs --local` validates the bot, command manifest and existing state without Discord credentials. `discord-bot-kit inspect --bot bot.mjs` returns contracts and a suggested next action. Preserve corrupt state for inspection; do not delete it to make a test pass. State may contain personal IDs, topics or votes; keep the live file and session evidence private.

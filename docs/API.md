# Bot contracts and scenarios

## Shared handler contract

```js
import { defineBot } from '@owenawsong/guildwright';
export default defineBot({
  name: 'My bot',
  commands: [{
    name: 'hello', description: 'Say hello',
    handler: async ctx => {
      await ctx.reply({ content: 'Hello!', ephemeral: true });
    }
  }],
  routes: []
});
```

`Bot.commands` contains name, description, optional permission/options and async handler. `Bot.routes` contains kind (`button`, `modal`, `select`), prefix, optional permission and async handler. The longest matching prefix wins. Avoid overlapping prefixes unless deliberate; handlers must validate route suffixes as input. Check ownership against guild-scoped durable state, as both recipes do. No transport guesses ownership from client-provided metadata.

`Context.input` contains actor, guildId, channelId, kind, name, fields, args, values, ageMs and interaction ID. `ctx.args` exposes validated flat command arguments. The simulator actors are fixed member/stranger/moderator fixtures. Autocomplete, subcommands, attachments, voice and message events are not supported in v0.1.

## Slash option schemas

```js
{
  name: 'announce', description: 'Publish a short announcement',
  options: [
    { name: 'text', description: 'Announcement text', type: 'string', required: true, minLength: 1, maxLength: 500 },
    { name: 'priority', description: 'Priority', type: 'integer', choices: [{ name: 'Normal', value: 1 }, { name: 'Urgent', value: 2 }] },
    { name: 'quiet', description: 'Quiet delivery', type: 'boolean' }
  ],
  handler: async ctx => ctx.reply({ content: String(ctx.args.text), ephemeral: Boolean(ctx.args.quiet) })
}
```

Supported types: `string`, `number`, `integer`, `boolean`, `user`, `channel`. User/channel values are validated snowflake ID strings, not resolved objects or authorization guarantees. Optional arguments are absent unless supplied; false and zero are preserved. String bounds use `minLength`/`maxLength`; number/integer bounds use `min`/`max`. String/number/integer choices have display name and correctly typed value. At most 25 flat options and 25 choices per option. Schema definition is checked when the bot is created; required options are sorted first in the Discord manifest. Local forms and real Discord input feed the same validation before handlers execute.

Context methods: `reply(Message)`, `defer(ephemeral = true)`, `deferUpdate()`, `edit(Message)`, `followup(Message)`, `modal(Modal)`, `require(Permission)`, `requireGuild()`, `effect(name, data)`. `deferUpdate()` is for buttons/selects and allows `edit()` to update their source message. Message supports content, ephemeral, buttons and a string select. Modal supports a title and required paragraph text fields. Discord's v1 action rows are used for these payloads. `effect()` records evidence, not a general side-effect transaction.

`Store.mutate(fn)` supplies an isolated draft and commits after validation/persistence. Never make remote network calls inside a mutation: reserve, perform the effect, then commit its outcome. `snapshot()` returns a copy. The included store has ticket and signup-event schemas; apps needing other durable schemas should use their own services rather than inserting unknown keys. Older ticket-only v1 files migrate in memory and gain event fields on the next commit.

## Executable scenario format

```json
{
  "name": "Greeting",
  "steps": [{
    "name": "hello",
    "actor": "member",
    "expect": { "event": "reply", "contentIncludes": "Hello", "clean": true }
  }]
}
```

Run `npm exec -- guildwright test --bot bot.mjs --scenario greeting.json --json`. Every scenario uses a fresh simulator; steps share that scenario's state. Inputs may include `args` with typed primitive values. Supported assertions: `code`, `event` lifecycle type, `contentIncludes`, `ticketCount`, `ticketStatus`, `eventCount`, `eventId`, `eventStatus`, `participantCount`, `clean`. Roster/status assertions address `eventId`, or the most recently created event if omitted. A failure returns the actual execution and exits nonzero. Assertions are deliberately explicit; the toolkit does not treat an AI judgment as a passing test.

`guildwright test` without a scenario runs the selected **bundled recipe suite** (11 tickets / 14 signups), not a generic test generator for arbitrary bots. `Bot.recipe` selects it. `npm test` in this repository runs library tests including persistence, option schemas, recovery and HTTP security.

## Diagnostic codes

| Code | Meaning |
| --- | --- |
| GW_DOUBLE_ACK | A second initial response was attempted |
| GW_ACK_TIMEOUT | Initial response missed the three-second window |
| GW_EDIT_BEFORE_ACK / GW_FOLLOWUP_BEFORE_ACK | Invalid response lifecycle |
| GW_NO_ACK | Handler completed without an initial response |
| GW_PERMISSION_DENIED | Actor is not authorized |
| GW_GUILD_REQUIRED | Server-only action was invoked in a DM |
| GW_UNKNOWN_ROUTE | No command/component handler exists |
| GW_INPUT_INVALID | Invalid modal/select value |
| GW_TICKET_MISSING | Guild-scoped ticket lookup failed |
| GW_PROVISION_INCOMPLETE / GW_CLOSE_INCOMPLETE | Ambiguous side effect requires recovery |
| GW_HANDLER_ERROR | Unhandled internal error, redacted in public response |
| GW_OUTPUT_INVALID | Message/modal payload exceeds supported Discord limits |
| GW_BOT_PERMISSION / GW_SUPPORT_ROLE_MISSING | Known preflight failure before a channel is created |
| GW_ARGUMENT_REQUIRED / GW_ARGUMENT_UNKNOWN | Missing required or undeclared command option |
| GW_ARGUMENT_TYPE / GW_ARGUMENT_RANGE / GW_ARGUMENT_CHOICE | Argument fails type, bounds or choice validation |
| GW_UPDATE_CONTEXT | A command/modal attempted a component source-message update |
| GW_EVENT_MISSING / GW_EVENT_FULL / GW_EVENT_CLOSED | Signup lookup, capacity or lifecycle rejection |

## MCP (local stdio)

```json
{
  "mcpServers": {
    "guildwright": {
      "command": "node",
      "args": ["/absolute/path/Guildwright/dist/src/cli.js", "mcp", "--bot", "/absolute/path/my-bot/bot.mjs"]
    }
  }
}
```

Tools: `inspect_bot`, `simulate_interaction`, `run_recipe_scenarios`, `reset_simulation`. `simulate_interaction` accepts typed `args`. The JSON-RPC stdio implementation supports initialize, ping, tools/list and tools/call. State is in-memory and reset when the process ends. Tools cannot connect to Discord or register commands. Protocol version 2024-11-05; no resources, prompts or HTTP transport.

## Local server boundary

The playground binds loopback only. API mutation requires a random per-process session token; Host and Origin are checked. Assets are allowlisted, no CORS is enabled, and a restrictive CSP rejects remote scripts/frames. This is a development server for a trusted local machine, not a public hosting service. Importing `--bot` executes trusted JavaScript with the user's local privileges, like running a test suite.

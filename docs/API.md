# Bot contracts and scenarios

## Shared handler contract

```js
import { defineBot } from "@owenawsong/discord-bot-kit";
export default defineBot({
  name: "My bot",
  commands: [
    {
      name: "hello",
      description: "Say hello",
      handler: async (ctx) => {
        await ctx.reply({ content: "Hello!", ephemeral: true });
      },
    },
  ],
  routes: [],
});
```

`Bot.commands` contains name, description, optional permission/options and async handler. `Bot.routes` contains kind (`button`, `modal`, `select`), prefix, optional permission and async handler. The longest matching prefix wins. Avoid overlapping prefixes unless deliberate; handlers must validate route suffixes as input. Check ownership against guild-scoped durable state, as both recipes do. No transport guesses ownership from client-provided metadata.

`Context.input` contains actor, guildId, channelId, kind, name, fields, args, values, ageMs and interaction ID. `ctx.args` exposes validated command arguments. The simulator actors are fixed member/stranger/moderator fixtures. v0.2 supports canonical command paths such as `poll create` and `project labels add`, mapped to real Discord subcommands/groups. Attachments, voice and message events are outside this release.

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

Supported types: `string`, `number`, `integer`, `boolean`, `user`, `channel`. User/channel values are validated snowflake ID strings, not resolved objects or authorization guarantees. Optional arguments are absent unless supplied; false and zero are preserved. String bounds use `minLength`/`maxLength`; number/integer bounds use `min`/`max`. String/number/integer choices have display name and correctly typed value. At most 25 options and 25 choices per option. Schema definition is checked when the bot is created; required options are sorted first in the Discord manifest. Local forms and real Discord input feed the same validation before handlers execute.

### Subcommands and autocomplete

Use one to three space-separated path segments in `Command.name`. A root cannot simultaneously be an executable command and a group. The live adapter unwraps Discord's nested option data into the same canonical name/typed arguments used locally. Group-root default permission is applied when every branch shares it; otherwise branch permissions are enforced at runtime and autocomplete. A registration permission is never a replacement for handler authorization.

Set `option.autocomplete:true` on string/number/integer options and provide `command.autocomplete(ctx) => Promise<Suggestion[]>`. `ctx.focused` contains name/value; `ctx.args` contains completed other arguments. Its `state(name)` handle exposes only a copied snapshot, not mutation methods. The same handler runs locally and in Discord. Return at most 25 unique, correctly typed values within the final option's constraints. Suggestions do not guarantee resource authorization. Expired/slow requests return diagnostics/empty choices; autocomplete cannot be deferred. Arbitrary bot callbacks remain trusted JavaScript, so keep remote work and side effects out of them.

Context methods: `reply(Message)`, `defer(ephemeral = true)`, `deferUpdate()`, `edit(Message)`, `followup(Message)`, `modal(Modal)`, `require(Permission)`, `requireGuild()`, `effect(name, data)`, `state(name, options?)`, `serial(key, work)`. `deferUpdate()` is for buttons/selects and allows `edit()` to update their source message. Message supports optional content, embeds, ephemeral, buttons and a string select. Modal supports a title and required paragraph text fields. Discord's v1 action rows are used for these payloads. `effect()` records evidence, not a general side-effect transaction.

Embeds support title/description/color/URL, fields, footer, author, thumbnail, image and timestamp. At most ten per message; total text across them cannot exceed 6000 characters. Field count/text bounds and safe HTTP(S) URL forms are checked before transport. Local rendering may omit remote images intentionally; it never proves Discord's actual rendering.

`Store.mutate(fn)` supplies an isolated draft and commits after validation/persistence. Never make remote network calls inside a mutation: reserve, perform the effect, then commit its outcome. `snapshot()` returns a copy. Tickets and signups retain their compatible fields; custom domain state belongs in `Bot.stateSchemas` and `ctx.state()`. [Namespace guide](STATE.md) covers validators, versions, guild/global scope and transactional updates. Older v1 files gain namespace envelopes without losing existing records. Unknown top-level fields are rejected rather than silently discarded.

## Executable scenario format

```json
{
  "name": "Greeting",
  "steps": [
    {
      "name": "hello",
      "actor": "member",
      "expect": { "event": "reply", "contentIncludes": "Hello", "clean": true }
    }
  ]
}
```

Run `npm exec -- discord-bot-kit test --bot bot.mjs --scenario greeting.json --json`. Every scenario uses a fresh simulator; steps share that scenario's state. Inputs may include `args` with typed primitive values. Supported assertions: `code`, `event` lifecycle type, `contentIncludes`, `ticketCount`, `ticketStatus`, `eventCount`, `eventId`, `eventStatus`, `participantCount`, `clean`. Roster/status assertions address `eventId`, or the most recently created event if omitted. A failure returns the actual execution and exits nonzero. Assertions are deliberately explicit; the toolkit does not treat an AI judgment as a passing test.

`discord-bot-kit test` without a scenario runs the selected **bundled recipe suite** (11 tickets / 14 signups / 8 polls), not a generic test generator for arbitrary bots. `Bot.recipe` selects it. Custom bots use [advanced scenarios](SCENARIOS.md): captures, typed references, exact JSON-pointer assertions, parallel batches and fault fixtures. `--out` writes downloadable evidence; `replay --evidence` reruns it in isolation. `npm test` runs library tests including persistence, schemas, recovery and HTTP security.

## Diagnostic codes

| Code                                                                       | Meaning                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| GW_DOUBLE_ACK                                                              | A second initial response was attempted                     |
| GW_ACK_TIMEOUT                                                             | Initial response missed the three-second window             |
| GW_EDIT_BEFORE_ACK / GW_FOLLOWUP_BEFORE_ACK                                | Invalid response lifecycle                                  |
| GW_NO_ACK                                                                  | Handler completed without an initial response               |
| GW_PERMISSION_DENIED                                                       | Actor is not authorized                                     |
| GW_GUILD_REQUIRED                                                          | Server-only action was invoked in a DM                      |
| GW_UNKNOWN_ROUTE                                                           | No command/component handler exists                         |
| GW_INPUT_INVALID                                                           | Invalid modal/select value                                  |
| GW_TICKET_MISSING                                                          | Guild-scoped ticket lookup failed                           |
| GW_PROVISION_INCOMPLETE / GW_CLOSE_INCOMPLETE                              | Ambiguous side effect requires recovery                     |
| GW_HANDLER_ERROR                                                           | Unhandled internal error, redacted in public response       |
| GW_OUTPUT_INVALID                                                          | Message/modal payload exceeds supported Discord limits      |
| GW_BOT_PERMISSION / GW_SUPPORT_ROLE_MISSING                                | Known preflight failure before a channel is created         |
| GW_ARGUMENT_REQUIRED / GW_ARGUMENT_UNKNOWN                                 | Missing required or undeclared command option               |
| GW_ARGUMENT_TYPE / GW_ARGUMENT_RANGE / GW_ARGUMENT_CHOICE                  | Argument fails type, bounds or choice validation            |
| GW_UPDATE_CONTEXT                                                          | A command/modal attempted a component source-message update |
| GW_EVENT_MISSING / GW_EVENT_FULL / GW_EVENT_CLOSED                         | Signup lookup, capacity or lifecycle rejection              |
| GW_STATE_UNKNOWN / GW_STATE_INVALID / GW_STATE_VERSION                     | Namespace registration, draft or stored-version rejection   |
| GW_STATE_MUTABILITY                                                        | Scalar state attempted mutable transact; use update         |
| GW_AUTOCOMPLETE_UNKNOWN / GW_AUTOCOMPLETE_OUTPUT / GW_AUTOCOMPLETE_TIMEOUT | Suggestion handler, output or deadline issue                |
| GW_POLL_MISSING / GW_POLL_CLOSED                                           | Poll lookup or closed-voting rejection                      |

## MCP (local stdio)

```json
{
  "mcpServers": {
    "discord-bot-kit": {
      "command": "node",
      "args": [
        "/absolute/path/discord-bot-kit/dist/src/cli.js",
        "mcp",
        "--bot",
        "/absolute/path/my-bot/bot.mjs"
      ]
    }
  }
}
```

Tools: `inspect_bot`, `simulate_interaction`, `run_recipe_scenarios`, `reset_simulation`, `inspect_state`, `run_scenario`, `autocomplete`. `simulate_interaction` accepts typed args and optional fault fixtures. `run_scenario` accepts an inline scenario or a JSON file inside the bot project (resolved paths, including symlinks, must remain inside); it uses fresh state. `inspect_state` only inspects the current in-memory MCP session, never live files. The JSON-RPC stdio implementation supports initialize, ping, tools/list and tools/call. State resets when the process ends. Tools cannot register commands or connect the supplied adapter to Discord. Protocol version 2024-11-05; no resources, prompts or HTTP transport.

### Local HTTP contract

All mutation endpoints require `X-Discord-Bot-Kit-Session`; no CORS is enabled. GET `/api/session` returns commands, routes, namespace contracts, current/initial state and history. POST `/api/run` accepts fixture actor name, interaction kind/name, typed args/fields/values, age, channel, DM and optional faults. POST `/api/autocomplete` adds option/focused value and returns choices/diagnostics. POST `/api/scenario` or `/api/test` with `{scenario}` runs a custom isolated report; `/api/test` with `{}` runs the recipe suite. GET `/api/evidence` exports a session without the session token. POST `/api/replay` with `{evidence}` restores its validated checkpoint and replays in fresh state, without changing the interactive session. POST `/api/reset` clears simulated state/history. [Evidence format and limits](SCENARIOS.md).

## Local server boundary

The playground binds loopback only. API mutation requires a random per-process session token; Host and Origin are checked. Assets are allowlisted, no CORS is enabled, and a restrictive CSP rejects remote scripts/frames. This is a development server for a trusted local machine, not a public hosting service. Importing `--bot` executes trusted JavaScript with the user's local privileges, like running a test suite.

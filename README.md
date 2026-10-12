# Guildwright

### Build Discord bots with a feedback loop your coding agent can use.

**Run the interaction. Inspect the failure. Keep the test.**

Guildwright gives you and your agent a local workspace for Discord bot development: slash commands, buttons, modals, select menus, state inspection, executable scenarios and replayable evidence. Your actual handlers run in the simulator. The same bot definition connects to Discord through the included adapter.

**Node 22.12+ · TypeScript · CLI + MCP · MIT**

[Get started](#open-the-workspace) · [Agent workflow](docs/AGENT_WORKFLOW.md) · [API](docs/API.md) · [Scenarios](docs/SCENARIOS.md) · [Discord setup](docs/DISCORD_SETUP.md)

```text
                         YOUR BOT DEFINITION
                                 │
                  ┌──────────────┴──────────────┐
                  ▼                             ▼
           LOCAL WORKSPACE                DISCORD ADAPTER
     commands · components · state     test-guild registration
                  │                       gateway transport
                  ▼
        TRACE → ASSERTIONS → REPLAY
             executable evidence
```

## Open the workspace

No Discord token or AI account is needed for local development.

```bash
git clone https://github.com/owenawsong/Guildwright.git
cd Guildwright
npm ci
npm run dev
```

Open **http://127.0.0.1:18874** and try this:

1. Run `/ticket` and submit the modal.
2. Switch to **Rowan · Other member** and click **Close ticket**. Inspect the authorization diagnostic and state changes.
3. Switch to the moderator and close the ticket.
4. Select **Turn session into a test**, review the inferred assertions, and run it against fresh state.

The workspace keeps the conversation, event timeline, state differences and execution history together. Its **Bot contract** view exposes options, permissions, component routes and namespace schemas. The **Test scenarios** view accepts editable JSON and reports failing paths; session exports can be replayed in a separate simulator.

## Three working bots to learn from

| Recipe | Workflow | Useful failure cases |
| --- | --- | --- |
| **Tickets** | Modal → reserved state → private channel → authorized close | Concurrent submissions, another member closing a ticket, ambiguous channel creation and recovery |
| **Event signups** | Create an event → join/leave → capacity → close | Duplicate joins, competing final places, stale buttons and ordered message edits |
| **Polls** | Subcommands → embedded card → vote/select → close | Changed votes, concurrent voting, ownership, autocomplete and persistent custom state |

```bash
npm run build
node dist/src/cli.js playground --recipe signups --port 18875
# In another terminal:
node dist/src/cli.js playground --recipe polls --port 18876
```

The poll recipe is implemented with the public namespace API. It is an example of building your own domain without adding tables to Guildwright itself. [Poll walkthrough →](docs/POLLS.md)

## Give your agent a complete working loop

Create a bot in a **new directory**:

```bash
node dist/src/cli.js init ../my-bot --recipe polls
cd ../my-bot
npm install
npm test
npm run playground
```

Choose `tickets`, `signups` or `polls`. Each starter includes a matching bot, scenario, deployment configuration, focused `AGENTS.md` and API/state/scenario guides. The dependency points to your local clone. For a portable installation, build a tarball with `npm pack` and supply its absolute path using `init --package /path/to/package.tgz`. No public npm release is assumed.

> Read AGENTS.md. Add a command that shows a member's vote privately. Add a scenario for a member without a vote and one after voting. Run both, inspect the execution evidence, and show the result in the local workspace.

The [included agent skill](skills/guildwright/SKILL.md) teaches the local loop. The [stdio MCP server](docs/API.md#mcp-local-stdio) exposes inspect, simulate, test, replay and reset operations. MCP cannot connect to Discord or register live commands.

## State your bot can own

Declare versioned JSON state, scoped to a guild by default:

```js
import { defineBot, defineNamespace } from '@owenawsong/guildwright';

const counter = defineNamespace({
  name: 'counter', version: 1, initial: { count: 0 },
  validate: value => value && Number.isSafeInteger(value.count) && value.count >= 0
});

export default defineBot({
  name: 'Counter bot', stateSchemas: [counter], routes: [],
  commands: [{
    name: 'counter add', description: 'Increase the counter',
    handler: async ctx => {
      await ctx.defer();
      const count = await ctx.state('counter').transact(draft => ++draft.count);
      await ctx.edit({ content: `Count: ${count}`, ephemeral: true });
    }
  }]
});
```

Transactions serialize within one process, validate before persistence and return detached copies. Invalid mutations roll back. A stored version mismatch stops loading and preserves the file for explicit migration. `update()` replaces a root value; explicit global scope supports shared application data. [State guarantees and limits →](docs/STATE.md)

## Tests that explain what broke

Scenarios exercise actual handlers. Assertions cover diagnostic codes, lifecycle events, content, exact JSON paths and missing values. Captures carry generated IDs into later interactions; parallel batches test final-state invariants; fault fixtures exercise ambiguous effects.

```json
{
  "name": "Create and close a ticket",
  "steps": [
    {
      "name": "ticket:create", "kind": "modal",
      "fields": {"topic": "Need help"}, "saveAs": "created",
      "expect": {"clean": true, "ticketCount": 1}
    },
    {
      "name": "ticket:close:${created#/state/tickets/0/id}", "kind": "button",
      "expect": {"clean": true, "exact": {"/state/tickets/0/status": "closed"}}
    }
  ]
}
```

```bash
# Inside a generated project:
npm exec -- guildwright test --bot bot.mjs --scenario scenario.json --out evidence.json
npm exec -- guildwright replay --bot bot.mjs --evidence evidence.json
```

Failures exit nonzero and include remedies such as:

```text
GW_DOUBLE_ACK
This interaction already has an initial response.
After defer(), use edit(); after reply(), use followup().
```

Evidence includes inputs, events, diagnostics, state and definition fingerprints. Replay restores validated initial state in an isolated simulator. Fingerprints cover registered function text and contract metadata; retain source versions because imported dependencies and closure values are not covered. [Scenario and replay reference →](docs/SCENARIOS.md)

## What v0.2 supports

| Area | Included |
| --- | --- |
| Commands | Typed options, choices, bounds, booleans, user/channel IDs, subcommands and groups |
| Autocomplete | Read-only local execution, validated choices, live adapter responses |
| Components | Buttons, modals, select menus, embedded messages and component updates |
| Diagnostics | Double acknowledgement, missed deadlines, permissions, options and state errors |
| State | Versioned namespaces, guild/global scopes, validated transactions and persistence |
| Verification | Captures, exact/absent assertions, parallel batches, fault fixtures, evidence and replay |
| Tools | Local browser workspace, CLI, agent skill and stdio MCP |
| Live transport | discord.js gateway adapter and preview/apply test-guild command registration |

## Verify and connect

```bash
npm run check       # core tests and all three recipe suites
npm pack            # build a portable package
```

CI checks Node 22/24 on Linux and Windows, including fresh installs of all three generated starters. Tests cover state isolation, rollback, restart persistence, concurrency, response lifecycle, commands, embeds, autocomplete, evidence replay, HTTP boundaries and MCP project containment.

The simulator approximates Discord interactions. Gateway events, actual permission overwrites, rate limits, network timing, resolved user/channel objects, attachments and Discord's exact rendering require a real test guild. Measured timings are local handler times. The adapter is implemented and type-checked; **authenticated live-guild verification remains a release gate**. [Test-guild procedure →](docs/DISCORD_SETUP.md)

The JSON store supports one process per file. Replicated deployments need shared transactional storage. Trusted bot handlers are executable Node code, not sandboxed plugins. Live state and evidence can contain personal data. Registration requires explicit `--apply` and replaces the configured application's guild command list.

## Contribute

Bring a workflow, a failing scenario and a fix. New recipes should demonstrate authorization, state ownership and recovery—not just a happy-path command.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [MIT license](LICENSE)

Built by [Owen Song](https://github.com/owenawsong), a student developer. Independent project; not affiliated with Discord.

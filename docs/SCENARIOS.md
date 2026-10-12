# Capture behavior as executable evidence

Run a JSON scenario against your actual handlers:

```bash
npm exec -- guildwright test --bot bot.mjs --scenario scenario.json --out evidence.json
npm exec -- guildwright replay --bot bot.mjs --evidence evidence.json
```

The runner creates isolated state. Your interactive session and live state file are untouched. Each step returns its input, events, diagnostics, resulting state and simulated channel fixtures. A failing assertion exits nonzero and names the mismatched path/value.

## Captures and references

```json
{
  "name": "Ticket recovery",
  "steps": [
    {
      "name": "ticket:create",
      "kind": "modal",
      "fields": { "topic": "Help" },
      "saveAs": "created",
      "expect": { "clean": true, "ticketCount": 1 }
    },
    {
      "name": "ticket:close:${created#/state/tickets/0/id}",
      "kind": "button",
      "expect": {
        "clean": true,
        "exact": { "/state/tickets/0/status": "closed" }
      }
    }
  ]
}
```

`saveAs` captures a complete execution under a unique name. `${capture#/pointer}` interpolates a primitive into a string. `{"$ref":"capture#/pointer"}` preserves the referenced value's JSON type. `replay: "capture"` repeats that execution's input; explicit name/actor/args/fields/values/kind/channelId/ageMs/guildId/DM overrides can test a changed caller or stale component. References cannot evaluate code or access inherited properties. JSON pointers follow RFC 6901 (`~0` for `~`, `~1` for `/`); malformed escapes are rejected.

## Assertions

Existing v0.1 assertions remain: diagnostic `code`, lifecycle `event`, `contentIncludes`, ticket/event counts/statuses, roster counts and `clean`. `clean:true` requires no diagnostics; `clean:false` requires at least one. `exact` maps JSON pointers in the execution to expected values. `absent` asserts valid paths do not exist. Namespace examples:

```json
{
  "exact": {
    "/state/namespaces/counter/guilds/workshop-guild/count": 3,
    "/events/0/type": "defer"
  },
  "absent": ["/state/namespaces/counter/global"]
}
```

Use actor fixture names `member`, `stranger`, `moderator`. Set `dm:true` for no guild or `guildId` to exercise another simulated guild. IDs are fixtures, not live Discord accounts.

## Parallel batches

```json
{
  "label": "Three concurrent joins",
  "parallel": [
    {
      "name": "event-join",
      "args": { "event": "event-1" },
      "expect": { "clean": true }
    },
    {
      "name": "event-join",
      "actor": "stranger",
      "args": { "event": "event-1" },
      "expect": { "clean": true }
    },
    {
      "name": "event-join",
      "args": { "event": "event-1" },
      "expect": { "clean": true }
    }
  ],
  "expect": { "participantCount": 2, "clean": true }
}
```

Branches share isolated state and start concurrently. Captures from earlier steps are available; captures created inside a batch become available only after all branches finish. Branch results flatten into `steps` with a `group` label; final-state assertions appear in `batches`. At most 200 top-level steps, 50 branches per batch, 500 interactions total. Assert invariants rather than an arbitrary winning order.

## Fault fixtures

Each step may include `faults`: `send` (one event type fails once), `createTicket`/`closeTicket` (`before` or `after` the simulated effect), `delaySendMs` (0–3000). These affect only the simulated port. `after` models an ambiguous remote outcome and exercises reservation/recovery behavior. It is not a real network emulator. Session evidence records active fixtures so replay can repeat them.

## Evidence and replay

Scenario reports use `format: "guildwright.scenario"`, format version 1, tool version, original scenario, inputs/results, captures, final state and scenario/definition hashes. Session exports use `guildwright.session`, initial state and executions. Imported initial state is validated against current contracts before isolated replay.

Replay invokes the current bot implementation. The definition fingerprint covers registered handler/validator function text and contract metadata, **not imported dependencies or captured closure values**. Dates, generated IDs, external work in trusted handlers and concurrent ordering are not guaranteed to be byte-identical. This is reproducible input/assertion evidence, not a claim of hermetic execution. Inspect source/current fingerprints and retain version-controlled source with published evidence.

Evidence can contain personal IDs and input text. Review before sharing. No session secret or Discord token is included automatically.

The interactive HTTP session serializes its commands and reset operations. It retains the most recent 100 executions; when older executions are removed, the exported initial checkpoint advances to their final state. Use a scenario parallel batch to exercise concurrent behavior deliberately.

---
name: guildwright
description: Build and verify a Guildwright Discord bot with local interaction simulation, scenario evidence, and shared production handlers.
---

# Build a bot people can trust

Use the installed `guildwright` CLI through the project's npm scripts or `npm exec -- guildwright ...`; no global installation is assumed. Read `DISCORD_SETUP.md` before live Discord operations. Never ask for tokens in chat or add .env to Git.

## Development loop

1. Inspect `bot.mjs` and `scenario.json`; run `guildwright inspect --bot bot.mjs`.
2. Implement handlers in the Bot export. Reuse a recipe or add your own commands/routes. Declare slash options and use validated `ctx.args`; no parallel mock handlers. Use versioned namespaces for custom data, defaulting to the current guild.
3. Run `guildwright test --bot bot.mjs --scenario scenario.json --json`. Add assertions for the new behavior and forbidden behavior.
4. Run `guildwright playground --bot bot.mjs`; inspect the real UI, run commands, click components, submit modals, switch actors. Export evidence if helpful.
5. Fix the diagnostic's cause, rerun the relevant scenario, and describe what was tested. Do not infer production fidelity from local success.

## Interaction rules

- An initial response must occur within three seconds: `reply()`, `defer()`, or `modal()`.
- After `defer()`, use `edit()`; after `reply()`, use `followup()` for additional messages.
- Authorize every component and modal handler against current guild-scoped server state. Command registration permissions alone do not protect buttons.
- Validate modal/select values. Never trust a client-provided owner ID.
- Reserve an operation durably before remote effects. If network failure leaves the outcome ambiguous, reconcile instead of creating again.
- Keep one process per JSON state file. Production replicas need a transactional external store; the file store is not distributed.
- Use `ctx.state(name).transact()` for mutable object/array drafts, `update()` for scalar/replaced roots. Validators must return true; never overwrite an unknown stored schema version.
- Subcommand paths use spaces, e.g. `poll vote`. Autocomplete uses the same permission checks and only copied state; keep it fast and free of effects.
- Use exact JSON-pointer assertions and parallel batches for invariants. Capture dynamic IDs instead of hardcoding them. Retain source alongside evidence fingerprints; imported dependencies are not hashed.
- Live adapter logs diagnostic codes, not tokens or user transcript fields.

## CLI evidence

- `guildwright inspect --bot bot.mjs`: command manifest and component route map.
- `guildwright test --bot bot.mjs`: selected recipe checks (tickets/signups/polls); custom bots use scenario files.
- `guildwright test --bot bot.mjs --scenario scenario.json --json`: sequential inputs and concrete assertions.
- `guildwright simulate --bot bot.mjs --input interaction.json`: one Input with events, diagnostics, elapsed time and resulting state.
- `guildwright doctor`: offline environment/identifier validation, not token validity.
- `guildwright doctor --local`: offline contracts, manifest and state validation without credentials.
- `guildwright replay --bot bot.mjs --evidence evidence.json`: isolated evidence replay, never current-session/live-file mutation.
- `guildwright register --bot bot.mjs`: preview. `--apply` replaces this application's test-guild commands; obtain explicit human authorization first.
- `guildwright start --bot bot.mjs`: connects a real bot and may create/archive channels when users interact. Ask before operating a live account unless already authorized.

## What not to claim

The simulator does not reproduce gateway events, permission overwrites, rate limits, Discord rendering or real-network timing. A configured test guild is the final integration check. Tickets, event signups and namespace-based polls are reference recipes. The notification selector is a validation demonstration, not a notification service. Read docs/STATE.md and docs/SCENARIOS.md in the scaffold for general application workflows.

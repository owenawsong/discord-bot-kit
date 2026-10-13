# discord-bot-kit launch kit

## Positioning

A local development toolkit for Discord bots, with a browser workspace and CLI/MCP tools a coding agent can use. Its strongest demonstration is an interaction that behaves correctly, a forbidden click that fails correctly, and the executable scenario that preserves both.

## Repository description

Build and test Discord bots locally: reusable recipes, state inspection, executable scenarios, CLI and MCP tools.

## Short announcement

I built discord-bot-kit so a coding agent can do more than write Discord handlers and hope they work.

Run commands, buttons, modals and select menus locally. Switch members, inspect lifecycle diagnostics and state changes, then turn the session into a regression test.

It includes ticket, signup and poll starters, persistent custom state, CLI/MCP tools and a discord.js adapter. MIT; no Discord token needed for the local workspace.

https://github.com/owenawsong/discord-bot-kit

## Developer announcement

### discord-bot-kit: build a bot, exercise its interactions, keep the test

The difficult part of a bot often begins after its slash command works: a different member clicks the button, two users claim the final place, or channel creation times out after succeeding.

discord-bot-kit provides a local workspace around the actual handlers. You can invoke commands, submit modals, click components, switch actor fixtures and inspect events, diagnostics and state differences. Capture that session as editable JSON, add assertions and run it against fresh state.

Included tools:

- Tickets, event signups and polls with authorization, concurrency and recovery examples.
- Typed options, subcommands, groups, embeds and autocomplete.
- Versioned guild/global JSON namespaces with validation and atomic in-process updates.
- Scenarios with captures, exact path assertions, parallel batches and fault fixtures.
- Evidence replay, a CLI, agent instructions and a local stdio MCP server.
- A discord.js adapter that uses the same bot definitions.

Local verification includes 68 library tests, 33 recipe scenarios and clean starter installations. This is an interaction simulator, not a full Discord emulator; authenticated test-guild validation of the adapter remains pending.

Node22.12+, TypeScript, MIT. Previously called Guildwright, with compatibility for existing evidence and state.

https://github.com/owenawsong/discord-bot-kit

## Demonstration to record

1. Clone, install and open the ticket workspace.
2. Open a ticket as Mira; attempt closure as Rowan and show the permission diagnostic.
3. Close as the moderator and show the state difference.
4. Capture the session, inspect inferred assertions and run the scenario.
5. Show the poll starter's subcommands, autocomplete and namespace contracts.

Use real local executions. Explain where Discord simulation ends. Share in communities whose rules permit project showcases; publish the demo and quickstart together. Do not claim adoption, measured agent productivity or live Discord validation without evidence.

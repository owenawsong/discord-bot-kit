# A complete first session

Use this prompt with the coding agent you already have:

> Read AGENTS.md. Inspect the bot. Add a /hello command that replies privately with “Welcome aboard.” Add a scenario that proves the response and checks that it acknowledges cleanly. Run the scenario and the ticket recipe checks. Open the workshop and inspect both desktop and mobile. Report the actual commands and results. Do not register commands or connect to Discord yet.

The skill is in `skills/discord-bot-kit/SKILL.md`; `discord-bot-kit init` copies it into the bot as `AGENTS.md`, along with the state/scenario/API guides. For an existing project copy it into your agent's supported skill location, or link it from your own instructions. The tools work with any assistant capable of executing commands; there is no model subscription or API key for the workshop.

## Example progression

1. Build: agent edits the actual Bot export.
2. Exercise: use `/ticket` and submit a modal.
3. Attack: switch actors, attempt an unauthorized close, send an expired interaction.
4. Inspect: check precise diagnostic codes and resulting state.
5. Prove: turn that sequence into a scenario file and commit it.
6. Integrate: human configures a test guild and approves registration/start.

The agent sees executable failures, not just a checklist in prose. Exported evidence is JSON containing inputs, lifecycle events, diagnostic remedies and state. Avoid publishing personal ticket text or user IDs.

## Extending responsibly

Tickets, signups and polls have complete included examples. Polls demonstrate generic namespaces, subcommands, shared autocomplete, embeds and captured/parallel assertions. For your own feature, declare its schema rather than extending the built-in ticket state. Test exact state and rejection paths, not just a clean reply. For moderation and AI chat, implement domain services before advertising a recipe; AI chat additionally needs spend limits and cancellation. These are roadmap items.

Do not use an agent's confident explanation as a test oracle. Assertions should inspect actual outputs and state. The local suite cannot prove API behavior or real Discord permissions; record those separately.

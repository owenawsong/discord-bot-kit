# A generic namespace example: polls

```bash
node dist/src/cli.js playground --recipe polls --port 18876
node dist/src/cli.js init ../my-poll-bot --recipe polls
```

Polls use `defineNamespace`, shared slash subcommands, autocomplete, embeds, select menus, permission checks and exact state assertions. There is no poll-specific field in the framework's built-in state shape; see `src/polls.ts` and the eight-step advanced example in `examples/polls/scenario.json`.

Commands:

- `/poll create question:... answers:Tea | Coffee` creates 2–10 distinct answers.
- `/poll show poll:...` autocompletes IDs/questions from the current guild.
- `/poll vote poll:... answer:...` autocompletes answer labels and records one vote per member.
- `/poll close poll:...` retains results and rejects later votes.

The creator or a member with Manage Guild may close a poll; other members cannot. Repeating a vote keeps one record; choosing again replaces that member's answer. Closed polls retain the roster and counts. Guilds have independent namespaces and ID sequences. Component handlers check current state, so stale menus cannot reopen voting.

The bot needs View Channel and Send Messages for interactions. It does not need a support role, Manage Channels or Administrator. Use a dedicated test guild and verify actual embed/component behavior before inviting users.

The UI stores an interaction history; it is not a pixel-perfect Discord message renderer. Multiple separately posted cards are snapshots until interacted with. Edits for one poll serialize in process to avoid stale replies overwriting newer counts. There is no anonymous voting, scheduled closure or cross-server poll sharing implied.

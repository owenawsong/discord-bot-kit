# Guildwright → discord-bot-kit

The toolkit is now named **discord-bot-kit**. Version 0.2.1 keeps the v0.2 state schema and interaction APIs.

- Source repository: `owenawsong/discord-bot-kit`.
- Package/import: `@owenawsong/discord-bot-kit`.
- CLI: `discord-bot-kit`. The `guildwright` executable remains an alias in the package.
- Agent instructions: `skills/discord-bot-kit/SKILL.md`.
- State setting: `DISCORD_BOT_KIT_STATE`; the former `GUILDWRIGHT_STATE` remains accepted.

Existing applications should update package imports and npm scripts, then run their scenarios before connecting to Discord. Use a local tarball until an npm release has actually been published. Existing state files do not need a format migration.

New applications default to `.discord-bot-kit/live-state.json`. If only the previous `.guildwright/live-state.json` exists, it is used automatically. If both exist, the new path takes precedence. An explicit state environment setting or `--state` selects that exact path. Keep both directories ignored and do not delete live data during a rename.

New exports identify `discord-bot-kit.session` and `discord-bot-kit.scenario`; replay still accepts the corresponding `guildwright.*` version-1 formats. HTTP mutations accept either the new `X-Discord-Bot-Kit-Session` or legacy session header. The new header takes precedence when both are supplied.

New ticket channels use the `discord-bot-kit:` marker. Recovery recognizes complete legacy `guildwright:` markers too. Two matching channels across either identity remain ambiguous and require inspection; the rename does not weaken ownership checks or adopt an arbitrary channel.

# Release procedure

## Local verification

```bash
npm ci
npm test
node dist/src/cli.js test --json
npm pack
node dist/src/cli.js init ../guildwright-install-check --package /absolute/path/to/owenawsong-guildwright-0.1.0.tgz
```

In the generated directory, `npm install`, `npm test`, `npm run test:recipe`, and `npm run playground`. Verify buttons, modals, select menus, the permission-denied example and the scenario tab. Inspect desktop and narrow layouts. The package is not claimed to be published on npm; use the tested local tarball until a package release is intentionally published.

## What is ready

The shared TypeScript handlers, CLI, workshop, deterministic scenarios, package, MCP transport and single-process persistence can be released as v0.1.0. The license is MIT. CI covers Node 22/24 on Linux and Windows once dispatched on GitHub.

## Remaining empirical check

The real discord.js adapter must be exercised with an authenticated test guild using `DISCORD_SETUP.md`. Type checking and builder serialization are not live integration evidence. Do not advertise production Discord validation until that procedure is completed and recorded.

## Launch wording

> Guildwright gives your coding agent a local workshop for Discord bots. Run the same handlers in an interactive playground and a real discord.js adapter. Switch actors, click the button that shouldn't work, inspect the diagnostic, and turn the interaction into a repeatable scenario. The v0.1 toolkit includes shared slash option schemas, complete ticket/signup recipes, CLI, MCP tools, agent skill and portable JSON evidence.

Show `/ticket` → modal → channel reservation → unauthorized close → moderator close → passing scenario. Share the working clone command and actual screenshots. Avoid promises of full Discord emulation or universal production readiness.

## Privacy and distribution

Exclude `.env`, `.guildwright`, `_local`, `node_modules`, tokens and personal session exports. Inspect `npm pack --dry-run`. Verify README images resolve in a fresh clone. Release source archives should contain source, tests, lockfile, docs, assets, skills and CI—not local bot configurations.

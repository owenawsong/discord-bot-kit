# Release procedure

## Local verification

```bash
npm ci
npm run check
npm pack
node dist/src/cli.js init ../guildwright-install-check --recipe polls --package /absolute/path/to/owenawsong-guildwright-0.2.0.tgz
```

In the generated directory, `npm install`, `npm test`, `npm run test:recipe`, and `npm run playground`. Verify buttons, modals, select menus, the permission-denied example and the scenario tab. Inspect desktop and narrow layouts. The package is not claimed to be published on npm; use the tested local tarball until a package release is intentionally published.

## What is ready

The shared TypeScript handlers, versioned namespaces, advanced scenarios, CLI, workshop, package, MCP transport and single-process persistence can be released as v0.2.0. The license is MIT. CI covers Node 22/24 on Linux and Windows once dispatched on GitHub. The scenario inputs/assertions are repeatable; dates, generated IDs and concurrent ordering are not promised byte-identical.

## Remaining empirical check

The real discord.js adapter must be exercised with an authenticated test guild using `DISCORD_SETUP.md`. Type checking and builder serialization are not live integration evidence. Do not advertise production Discord validation until that procedure is completed and recorded.

## Launch wording

> Guildwright gives your coding agent a local workshop for Discord bots. Run shared handlers locally and through a discord.js adapter. Build your own domain with versioned JSON namespaces, inspect subcommands and autocomplete, test forbidden behavior and parallel updates, then keep the scenario as evidence. Tickets, signups and polls are runnable reference bots; custom scenarios and MCP tools work with your own contracts.

Show `/ticket` → modal → channel reservation → unauthorized close → moderator close → passing scenario. Share the working clone command and actual screenshots. Avoid promises of full Discord emulation or universal production readiness.

## Privacy and distribution

Exclude `.env`, `.guildwright`, `_local`, `node_modules`, tokens and personal session exports. Inspect `npm pack --dry-run`. Verify README images resolve in a fresh clone. Release source archives should contain source, tests, lockfile, docs, assets, skills and CI—not local bot configurations.

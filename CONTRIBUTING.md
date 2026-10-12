# Contributing

Node 22.12+ is required. Clone, `npm ci`, then `npm test`. `npm run dev` opens the workshop server. Run `node dist/src/cli.js test --json` and `node dist/src/cli.js test --recipe signups --json` for bundled recipe evidence.

Keep framework behavior in `src/core.ts`, domain workflows in recipes/services, network translation in `src/discord.ts`, simulation in `src/simulate.ts`, and rendering in `public`. Both environments must use the same handlers. No live tokens or server actions in CI.

For a bug include the command, Node/OS versions and a redacted scenario or execution export. For new recipes include adversarial scenarios and a documented real-guild test procedure. Avoid claims of perfect Discord emulation. Significant changes to response lifecycle or durable states need tests for failed/ambiguous effects and restart behavior.

Before a PR: `npm test`, `npm run check`, `npm pack --dry-run`, and inspect the package file list. UI changes should be inspected at desktop and 390px widths and with keyboard navigation. Static assets must run offline and support reduced motion.

import { existsSync } from "node:fs";

export const VERSION = "0.2.1";

/** Preserve an existing v0.2 deployment; new projects use the new identity. */
export function defaultStatePath(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.DISCORD_BOT_KIT_STATE ??
    env.GUILDWRIGHT_STATE ??
    (existsSync(".discord-bot-kit/live-state.json") ||
    !existsSync(".guildwright/live-state.json")
      ? ".discord-bot-kit/live-state.json"
      : ".guildwright/live-state.json")
  );
}

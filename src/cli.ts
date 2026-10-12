#!/usr/bin/env node
import { readFile, mkdir, writeFile, cp, stat } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ticketBot } from "./recipes.js";
import { signupBot } from "./signups.js";
import { pollBot } from "./polls.js";
import { runScenarios } from "./scenarios.js";
import { runScenario, replayEvidence, type Scenario } from "./workflow.js";
import { servePlayground } from "./server.js";
import {
  commandManifest,
  readConfig,
  registerCommands,
  startDiscord,
} from "./discord.js";
import { startMcp } from "./mcp.js";
import { defineBot } from "./core.js";
import type { Bot } from "./types.js";
import { Simulator } from "./simulate.js";
import { Store } from "./store.js";
const args = process.argv.slice(2);
const command = args[0] ?? "help";
function option(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function recipe() {
  const name = option("--recipe") ?? "tickets";
  if (!["tickets", "signups", "polls"].includes(name))
    throw new Error("Recipe must be tickets, signups or polls");
  return name as "tickets" | "signups" | "polls";
}
async function loadBot(): Promise<Bot> {
  const path = option("--bot");
  if (!path) {
    const selected = recipe();
    return selected === "signups"
      ? signupBot()
      : selected === "polls"
        ? pollBot()
        : ticketBot();
  }
  const imported = await import(pathToFileURL(resolve(path)).href);
  return defineBot(
    typeof imported.default === "function"
      ? await imported.default()
      : imported.default,
  );
}
function loadEnv() {
  try {
    process.loadEnvFile(resolve(".env"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
async function scaffold(destination: string) {
  const selectedRecipe = recipe();
  const target = resolve(destination);
  try {
    await stat(target);
    throw new Error("Destination already exists. Choose a new directory.");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "package.json"),
    JSON.stringify(
      {
        name: "my-discord-bot",
        version: "0.2.0",
        private: true,
        type: "module",
        scripts: {
          playground: "guildwright playground --bot bot.mjs",
          test: "guildwright test --bot bot.mjs --scenario scenario.json",
          "test:recipe": "guildwright test --bot bot.mjs",
          doctor: "guildwright doctor --bot bot.mjs",
          register: "guildwright register --bot bot.mjs",
          start: "guildwright start --bot bot.mjs",
        },
        dependencies: {
          "@owenawsong/guildwright":
            option("--package") ?? `file:${root.replaceAll("\\", "/")}`,
        },
      },
      null,
      2,
    ) + "\n",
  );
  const factory =
    selectedRecipe === "signups"
      ? "signupBot"
      : selectedRecipe === "polls"
        ? "pollBot"
        : "ticketBot";
  await writeFile(
    join(target, "bot.mjs"),
    `import { ${factory} } from '@owenawsong/guildwright';\n\n// These same handlers run in the workshop and Discord.\nconst bot = ${factory}();\nbot.name = 'My ${selectedRecipe === "signups" ? "event" : selectedRecipe === "polls" ? "poll" : "support"} bot';\nexport default bot;\n`,
  );
  await writeFile(
    join(target, ".env.example"),
    "DISCORD_TOKEN=\nDISCORD_APPLICATION_ID=\nDISCORD_GUILD_ID=\n" +
      (selectedRecipe === "tickets" ? "DISCORD_SUPPORT_ROLE_ID=\n" : "") +
      "GUILDWRIGHT_STATE=.guildwright/live-state.json\n",
  );
  await writeFile(
    join(target, ".gitignore"),
    "node_modules/\n.env\n.guildwright/\n",
  );
  await cp(
    join(root, `examples/${selectedRecipe}/scenario.json`),
    join(target, "scenario.json"),
  );
  await cp(
    join(root, "skills/guildwright/SKILL.md"),
    join(target, "AGENTS.md"),
  );
  await cp(
    join(root, "docs/DISCORD_SETUP.md"),
    join(target, "DISCORD_SETUP.md"),
  );
  await mkdir(join(target, "docs"), { recursive: true });
  for (const name of ["API.md", "STATE.md", "SCENARIOS.md"])
    await cp(join(root, "docs", name), join(target, "docs", name));
  if (selectedRecipe === "polls")
    await cp(join(root, "docs/POLLS.md"), join(target, "docs/POLLS.md"));
  console.log(
    `Created ${target}\nNext: cd into that directory, npm install, then npm run playground.\nNo Discord credentials are needed for the local workshop.`,
  );
}
try {
  if (command === "init") {
    if (!args[1] || args[1].startsWith("--"))
      throw new Error("Usage: guildwright init <new-directory>");
    await scaffold(args[1]);
  } else if (command === "playground") {
    const port = Number(option("--port") ?? 18874);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid port");
    const server = await servePlayground(await loadBot(), {
      port,
      statePath: option("--state"),
    });
    const address = server.address();
    console.log(
      `Guildwright workshop: http://127.0.0.1:${typeof address === "object" && address ? address.port : port}/\nLocal simulation only. Ctrl+C to stop.`,
    );
  } else if (command === "test") {
    const bot = await loadBot();
    const scenario = option("--scenario");
    if (scenario) {
      const result = await runScenario(
        bot,
        JSON.parse(await readFile(resolve(scenario), "utf8")) as Scenario,
      );
      if (option("--out"))
        await writeFile(
          resolve(option("--out")!),
          JSON.stringify(result, null, 2) + "\n",
        );
      console.log(
        args.includes("--json")
          ? JSON.stringify(result, null, 2)
          : `${result.passed ? "PASS" : "FAIL"} ${result.name}\n` +
              result.steps
                .map(
                  (s) =>
                    `${s.passed ? "PASS" : "FAIL"} step ${s.step}: ${s.name}${s.errors.length ? " — " + s.errors.join("; ") : ""}`,
                )
                .join("\n") +
              result.batches
                .filter((b) => !b.passed)
                .map((b) => `\nFAIL ${b.label}: ${b.errors.join("; ")}`)
                .join(""),
      );
      if (!result.passed) process.exitCode = 1;
    } else {
      const results = await runScenarios(bot);
      console.log(
        args.includes("--json")
          ? JSON.stringify(results, null, 2)
          : results
              .map(
                (r) =>
                  `${r.passed ? "PASS" : "FAIL"} ${r.name}${r.passed ? "" : " — " + r.detail}`,
              )
              .join("\n"),
      );
      if (results.some((r) => !r.passed)) process.exitCode = 1;
    }
  } else if (command === "inspect") {
    const bot = await loadBot();
    console.log(
      JSON.stringify(
        {
          name: bot.name,
          recipe: bot.recipe ?? "custom",
          commands: commandManifest(bot),
          routes: bot.routes.map(({ handler, ...r }) => r),
          stateSchemas: (bot.stateSchemas ?? []).map(({ validate, ...s }) => s),
          nextAction: bot.recipe
            ? "Run the bundled suite, then exercise the workshop."
            : "Write a scenario for these handlers and run test --scenario scenario.json.",
        },
        null,
        2,
      ),
    );
  } else if (command === "simulate") {
    const path = option("--input");
    if (!path)
      throw new Error("Usage: guildwright simulate --input interaction.json");
    const value = JSON.parse(await readFile(resolve(path), "utf8"));
    console.log(
      JSON.stringify(await new Simulator(await loadBot()).run(value), null, 2),
    );
  } else if (command === "replay") {
    const path = option("--evidence");
    if (!path)
      throw new Error("Usage: guildwright replay --evidence evidence.json");
    const result = await replayEvidence(
      await loadBot(),
      JSON.parse(await readFile(resolve(path), "utf8")),
    );
    console.log(JSON.stringify(result, null, 2));
    if ("passed" in result && !result.passed) process.exitCode = 1;
  } else if (command === "mcp")
    startMcp(await loadBot(), {
      scenarioRoot: option("--bot")
        ? dirname(resolve(option("--bot")!))
        : process.cwd(),
    });
  else if (command === "doctor") {
    loadEnv();
    try {
      const bot = await loadBot();
      commandManifest(bot);
      const store = new Store(
        option("--state") ??
          process.env.GUILDWRIGHT_STATE ??
          ".guildwright/live-state.json",
      );
      store.configure(bot.stateSchemas);
      await store.load();
      if (!args.includes("--local"))
        readConfig(process.env, { tickets: bot.recipe === "tickets" });
      console.log(
        "PASS Node runtime\nPASS bot definitions and command manifest\nPASS state format, registered namespace versions and validators" +
          (args.includes("--local")
            ? "\nSKIPPED Discord configuration (--local)"
            : "\nPASS required environment variables\nPASS identifier formats") +
          "\nNOT CHECKED Discord token validity, guild access, role existence and channel permissions.\nNEXT: run custom scenarios and the workshop, then preview registration and finish with an authorized test guild.",
      );
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      console.error(
        "NEXT: inspect the named schema/configuration issue. Use doctor --local and the workshop without credentials.",
      );
      process.exitCode = 1;
    }
  } else if (command === "register") {
    if (args.includes("--apply")) {
      loadEnv();
      const bot = await loadBot();
      console.log(
        JSON.stringify(
          await registerCommands(
            bot,
            readConfig(process.env, { tickets: bot.recipe === "tickets" }),
            true,
          ),
          null,
          2,
        ),
      );
    } else
      console.log(
        JSON.stringify(
          {
            apply: false,
            warning:
              "Preview only. --apply replaces guild commands for this application.",
            commands: commandManifest(await loadBot()),
          },
          null,
          2,
        ),
      );
  } else if (command === "start") {
    loadEnv();
    const bot = await loadBot();
    const client = await startDiscord(
      bot,
      readConfig(process.env, { tickets: bot.recipe === "tickets" }),
    );
    const stop = () => {
      client.destroy();
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } else if (command === "help")
    console.log(
      `Guildwright · build with an agent, prove it locally\n\ninit <dir>       Scaffold a bot [--recipe tickets|signups|polls]\nplayground       Interactive local workshop [--port 18874] [--state path]\ninspect          Command manifest and component routes\ntest             Recipe checks or custom scenario [--scenario path] [--json] [--out file]\nsimulate         Run an Input JSON file [--input path]\nreplay           Isolated replay [--evidence evidence.json]\nmcp              Local stdio MCP server\ndoctor           Offline contract/state/config checks [--local]\nregister         Preview registration [--apply to replace guild commands]\nstart            Connect to Discord using .env\n\nUse --bot path/to/bot.mjs for your own Bot export, or --recipe tickets|signups|polls.\nNode 22.12+ · docs/DISCORD_SETUP.md for real-server setup.`,
    );
  else throw new Error(`Unknown command ${command}. Run guildwright help.`);
} catch (e) {
  console.error(
    `Guildwright: ${e instanceof Error ? e.message : "Operation failed"}`,
  );
  process.exitCode = 1;
}

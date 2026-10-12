import { createInterface } from "node:readline";
import { readFile, stat, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import type { Bot } from "./types.js";
import { Simulator, input, actors } from "./simulate.js";
import { runScenarios } from "./scenarios.js";
import { validateSession, type Session } from "./server.js";
import { runScenario, type Scenario } from "./workflow.js";
import { runAutocomplete } from "./autocomplete.js";
export function startMcp(bot: Bot, options: { scenarioRoot?: string } = {}) {
  let sim = new Simulator(bot);
  const scenarioRoot = resolve(options.scenarioRoot ?? process.cwd());
  const tools = [
    {
      name: "inspect_bot",
      description:
        "List commands and component routes without executing Discord actions.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "simulate_interaction",
      description:
        "Execute the real bot handler locally. Returns replies, effects, diagnostics and durable state. No Discord connection.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: {
            type: "string",
            enum: ["command", "button", "modal", "select"],
          },
          actor: { type: "string", enum: ["member", "stranger", "moderator"] },
          args: {
            type: "object",
            additionalProperties: {
              anyOf: [
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
              ],
            },
          },
          fields: { type: "object", additionalProperties: { type: "string" } },
          values: { type: "array", items: { type: "string" } },
          ageMs: { type: "number" },
          dm: { type: "boolean" },
          channelId: { type: "string" },
          faults: {
            type: "object",
            properties: {
              send: {
                type: "string",
                enum: [
                  "reply",
                  "defer",
                  "deferUpdate",
                  "edit",
                  "followup",
                  "modal",
                  "effect",
                ],
              },
              createTicket: { type: "string", enum: ["before", "after"] },
              closeTicket: { type: "string", enum: ["before", "after"] },
              delaySendMs: { type: "integer", minimum: 0, maximum: 3000 },
            },
            additionalProperties: false,
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "run_recipe_scenarios",
      description:
        "Run the selected ticket, signup or poll recipe checks in isolated simulation. Use run_scenario for custom bots.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "reset_simulation",
      description: "Reset only the local in-memory workshop session.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "inspect_state",
      description:
        "Inspect only this in-memory simulation session and registered namespace contracts. Never reads live state.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "run_scenario",
      description:
        "Run a custom scenario in fresh isolated state. Supply a scenario object or project-relative JSON path; does not change this simulation session.",
      inputSchema: {
        type: "object",
        properties: { scenario: { type: "object" }, path: { type: "string" } },
        additionalProperties: false,
      },
    },
    {
      name: "autocomplete",
      description:
        "Run the same permission-checked read-only autocomplete handler used in the local lab and Discord.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          option: { type: "string" },
          value: { anyOf: [{ type: "string" }, { type: "number" }] },
          actor: { type: "string", enum: ["member", "stranger", "moderator"] },
          args: { type: "object" },
          dm: { type: "boolean" },
          ageMs: { type: "number" },
        },
        required: ["name", "option", "value"],
        additionalProperties: false,
      },
    },
  ];
  let queue = Promise.resolve();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    queue = queue
      .then(async () => {
        if (Buffer.byteLength(line) > 1_000_000) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32600, message: "Request exceeds 1 MB" },
            }) + "\n",
          );
          return;
        }
        let req: {
          jsonrpc?: string;
          id?: number | string | null;
          method: string;
          params?: {
            name?: string;
            arguments?: Session & {
              scenario?: Scenario;
              path?: string;
              option?: string;
              value?: string | number;
            };
          };
        };
        try {
          req = JSON.parse(line);
        } catch {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            }) + "\n",
          );
          return;
        }
        if (
          !req ||
          typeof req !== "object" ||
          Array.isArray(req) ||
          req.jsonrpc !== "2.0" ||
          typeof req.method !== "string" ||
          (req.id !== undefined &&
            req.id !== null &&
            typeof req.id !== "string" &&
            typeof req.id !== "number")
        ) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32600, message: "Invalid Request" },
            }) + "\n",
          );
          return;
        }
        if (req.id === undefined) return;
        try {
          let result: unknown;
          if (req.method === "initialize")
            result = {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "guildwright", version: "0.2.0" },
            };
          else if (req.method === "ping") result = {};
          else if (req.method === "tools/list") result = { tools };
          else if (req.method === "tools/call") {
            let value: unknown;
            if (req.params?.name === "inspect_bot")
              value = {
                name: bot.name,
                recipe: bot.recipe ?? "custom",
                commands: bot.commands.map(
                  ({ handler, autocomplete, ...x }) => x,
                ),
                routes: bot.routes.map(({ handler, ...x }) => x),
                stateSchemas: sim.store.contracts(),
                nextAction:
                  "Run custom scenarios or simulate a command; live registration requires explicit CLI authorization.",
              };
            else if (req.params?.name === "simulate_interaction") {
              const b = req.params.arguments;
              validateSession(b);
              value = await sim.run(
                input(b.name!, {
                  kind: b.kind ?? "command",
                  actor: actors[b.actor ?? "member"],
                  fields: b.fields,
                  args: b.args,
                  values: b.values,
                  ageMs: b.ageMs,
                  channelId: b.channelId ?? "lobby",
                  guildId: b.dm ? undefined : "workshop-guild",
                }),
                b.faults,
              );
            } else if (
              req.params?.name === "run_recipe_scenarios" ||
              req.params?.name === "run_ticket_scenarios"
            )
              value = await runScenarios(bot);
            else if (req.params?.name === "reset_simulation") {
              sim = new Simulator(bot);
              value = { reset: true };
            } else if (req.params?.name === "inspect_state")
              value = {
                environment: "local-session",
                state: sim.store.snapshot(),
                contracts: sim.store.contracts(),
              };
            else if (req.params?.name === "run_scenario") {
              const args = req.params.arguments ?? {};
              let scenario = args.scenario;
              if (Boolean(args.path) === Boolean(scenario))
                throw new Error("Supply exactly one scenario or path");
              if (args.path) {
                const rootPath = await realpath(scenarioRoot),
                  path = await realpath(resolve(scenarioRoot, args.path));
                if (
                  (path !== rootPath && !path.startsWith(rootPath + sep)) ||
                  extname(path) !== ".json"
                )
                  throw new Error(
                    "Scenario paths must be JSON files inside the bot project",
                  );
                if ((await stat(path)).size > 512000)
                  throw new Error("Scenario file exceeds 512 KB");
                scenario = JSON.parse(await readFile(path, "utf8")) as Scenario;
              }
              value = await runScenario(bot, scenario!);
            } else if (req.params?.name === "autocomplete") {
              const b = req.params.arguments;
              validateSession(b);
              if (
                !b.option ||
                (typeof b.value !== "string" && typeof b.value !== "number")
              )
                throw new Error("Autocomplete needs option and focused value");
              value = await runAutocomplete(
                bot,
                {
                  name: b.name!,
                  option: b.option,
                  value: b.value,
                  args: b.args,
                  actor: actors[b.actor ?? "member"],
                  guildId: b.dm ? undefined : "workshop-guild",
                  ageMs: b.ageMs,
                },
                sim.store,
              );
            } else throw new Error("Unknown tool");
            result = {
              content: [{ type: "text", text: JSON.stringify(value) }],
              isError: false,
            };
          } else {
            process.stdout.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: req.id,
                error: { code: -32601, message: "Method not found" },
              }) + "\n",
            );
            return;
          }
          process.stdout.write(
            JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\n",
          );
        } catch (e) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              error: {
                code: -32602,
                message: e instanceof Error ? e.message : "Invalid request",
              },
            }) + "\n",
          );
        }
      })
      .catch(() => {});
  });
}

import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bot, Input, Execution } from "./types.js";
import {
  actors,
  input,
  Simulator,
  validateFaults,
  type FaultFixture,
} from "./simulate.js";
import { Store } from "./store.js";
import { runScenarios } from "./scenarios.js";
import {
  runScenario,
  replayEvidence,
  botFingerprint,
  type Scenario,
} from "./workflow.js";
import { runAutocomplete } from "./autocomplete.js";
export interface Session {
  actor?: string;
  kind?: Input["kind"];
  name?: string;
  fields?: Record<string, string>;
  values?: string[];
  ageMs?: number;
  dm?: boolean;
  channelId?: string;
  args?: Input["args"];
  faults?: FaultFixture;
}
export function validateSession(body: unknown): asserts body is Session {
  const b = body as Session;
  if (
    !b ||
    typeof b !== "object" ||
    typeof b.name !== "string" ||
    b.name.length > 100 ||
    !["command", "button", "modal", "select"].includes(b.kind ?? "command") ||
    (b.actor !== undefined && typeof b.actor !== "string") ||
    !Object.hasOwn(actors, b.actor ?? "member") ||
    (b.dm !== undefined && typeof b.dm !== "boolean") ||
    (b.ageMs !== undefined &&
      (!Number.isFinite(b.ageMs) || b.ageMs < 0 || b.ageMs > 900000))
  )
    throw new Error("Invalid interaction input");
  if (
    b.fields !== undefined &&
    (!b.fields ||
      typeof b.fields !== "object" ||
      Array.isArray(b.fields) ||
      Object.keys(b.fields).length > 25 ||
      Object.entries(b.fields).some(
        ([k, v]) => k.length > 100 || typeof v !== "string" || v.length > 4000,
      ))
  )
    throw new Error("Invalid modal fields");
  if (
    b.values !== undefined &&
    (!Array.isArray(b.values) ||
      b.values.length > 25 ||
      b.values.some((v) => typeof v !== "string" || v.length > 100))
  )
    throw new Error("Invalid select values");
  if (
    b.channelId !== undefined &&
    (typeof b.channelId !== "string" || b.channelId.length > 100)
  )
    throw new Error("Invalid channel ID");
  if (
    b.args !== undefined &&
    (!b.args ||
      typeof b.args !== "object" ||
      Array.isArray(b.args) ||
      Object.keys(b.args).length > 25 ||
      Object.entries(b.args).some(
        ([key, value]) =>
          key.length > 32 ||
          !["string", "number", "boolean"].includes(typeof value) ||
          (typeof value === "string" && value.length > 6000) ||
          (typeof value === "number" && !Number.isFinite(value)),
      ))
  )
    throw new Error("Invalid command arguments");
  if (b.faults !== undefined) validateFaults(b.faults);
}
async function body(req: IncomingMessage, max = 32768) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > max) throw new Error("Request is too large");
  }
  return JSON.parse(text || "{}") as unknown;
}
export async function servePlayground(
  bot: Bot,
  options: { port?: number; statePath?: string } = {},
) {
  const store = new Store(options.statePath);
  store.configure(bot.stateSchemas);
  await store.load();
  let simulator = new Simulator(bot, store);
  let initialState = store.snapshot();
  const session = randomBytes(32).toString("hex");
  const history: Execution[] = [];
  let sessionQueue = Promise.resolve();
  function inSession<T>(operation: () => Promise<T>): Promise<T> {
    const pending = sessionQueue.then(operation);
    sessionQueue = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  const publicRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../public",
  );
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      const address = server.address();
      const port =
        typeof address === "object" && address
          ? address.port
          : (options.port ?? 18874);
      const host = req.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        res.writeHead(403);
        res.end("Invalid host");
        return;
      }
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      if (path.startsWith("/api/")) {
        res.setHeader("Content-Type", "application/json");
        if (req.headers.origin && req.headers.origin !== `http://${host}`) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: "Origin rejected" }));
          return;
        }
        if (
          req.method === "POST" &&
          req.headers["x-guildwright-session"] !== session
        ) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: "Session token required" }));
          return;
        }
        if (path === "/api/session" && req.method === "GET") {
          res.end(
            JSON.stringify({
              session,
              bot: bot.name,
              recipe: bot.recipe ?? "custom",
              commands: bot.commands.map(
                ({ handler, autocomplete, ...c }) => c,
              ),
              routes: bot.routes.map(({ handler, ...r }) => r),
              stateSchemas: store.contracts(),
              state: store.snapshot(),
              initialState,
              history,
            }),
          );
          return;
        }
        if (path === "/api/run" && req.method === "POST") {
          const b = await body(req);
          validateSession(b);
          const result = await inSession(async () => {
            const execution = await simulator.run(
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
            history.push(execution);
            if (history.length > 100) initialState = history.shift()!.state;
            return execution;
          });
          res.end(JSON.stringify(result));
          return;
        }
        if (
          (path === "/api/test" || path === "/api/scenario") &&
          req.method === "POST"
        ) {
          const b = (await body(req, 512000)) as { scenario?: Scenario };
          if (path === "/api/scenario" && !b.scenario)
            throw new Error("Provide {scenario: {name,steps}}");
          res.end(
            JSON.stringify(
              b.scenario
                ? await runScenario(bot, b.scenario)
                : await runScenarios(bot),
            ),
          );
          return;
        }
        if (path === "/api/autocomplete" && req.method === "POST") {
          const b = (await body(req)) as Session & {
            option: string;
            value: string | number;
          };
          validateSession(b);
          if (
            typeof b.option !== "string" ||
            b.option.length > 32 ||
            (typeof b.value !== "string" && typeof b.value !== "number") ||
            (typeof b.value === "string" && b.value.length > 6000) ||
            (typeof b.value === "number" && !Number.isFinite(b.value))
          )
            throw new Error("Invalid autocomplete request");
          res.end(
            JSON.stringify(
              await runAutocomplete(
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
                store,
              ),
            ),
          );
          return;
        }
        if (path === "/api/evidence" && req.method === "GET") {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="guildwright-evidence.json"',
          );
          res.end(
            JSON.stringify(
              {
                format: "guildwright.session",
                version: 1,
                toolVersion: "0.2.0",
                bot: { name: bot.name, fingerprint: botFingerprint(bot) },
                createdAt: new Date().toISOString(),
                initialState,
                executions: history,
              },
              null,
              2,
            ),
          );
          return;
        }
        if (path === "/api/replay" && req.method === "POST") {
          const b = (await body(req, 512000)) as { evidence?: unknown };
          res.end(JSON.stringify(await replayEvidence(bot, b.evidence ?? b)));
          return;
        }
        if (path === "/api/reset" && req.method === "POST") {
          const state = await inSession(async () => {
            await store.mutate((s) => {
              s.tickets = [];
              s.nextTicket = 1;
              s.events = [];
              s.nextEvent = 1;
              s.namespaces = {};
            });
            history.length = 0;
            simulator = new Simulator(bot, store);
            initialState = store.snapshot();
            return store.snapshot();
          });
          res.end(JSON.stringify({ state }));
          return;
        }
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Unknown endpoint" }));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end();
        return;
      }
      const asset = path === "/" ? "index.html" : path.slice(1);
      if (!["index.html", "style.css", "app.js"].includes(asset)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const data = await readFile(resolve(publicRoot, asset));
      res.setHeader(
        "Content-Type",
        extname(asset) === ".html"
          ? "text/html; charset=utf-8"
          : extname(asset) === ".css"
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
      );
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: e instanceof Error ? e.message : "Invalid request",
        }),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 18874, "127.0.0.1", resolve);
  });
  return server;
}

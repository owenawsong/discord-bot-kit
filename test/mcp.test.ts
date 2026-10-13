import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("MCP custom scenario paths cannot escape through traversal or directory links", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "discord-bot-kit-mcp-"));
  const project = join(workspace, "project"),
    outside = join(workspace, "outside");
  await mkdir(project);
  await mkdir(outside);
  const scenario = JSON.stringify({
    name: "Permitted local scenario",
    steps: [{ name: "ping", expect: { clean: true } }],
  });
  await writeFile(join(project, "inside.json"), scenario);
  await writeFile(join(outside, "outside.json"), scenario);
  await symlink(
    outside,
    join(project, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(
    join(project, "bot.mjs"),
    `import {ticketBot} from ${JSON.stringify(new URL("../src/index.js", import.meta.url).href)};export default ticketBot();`,
  );
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../src/cli.js", import.meta.url)),
      "mcp",
      "--bot",
      join(project, "bot.mjs"),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (x) => (stdout += x));
  child.stderr.on("data", (x) => (stderr += x));
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Exit ${code}: ${stderr}`)),
    );
  });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    ["inside.json", "../outside/outside.json", "linked/outside.json"].forEach(
      (path, index) =>
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: index,
            method: "tools/call",
            params: { name: "run_scenario", arguments: { path } },
          }) + "\n",
        ),
    );
    child.stdin.end();
    await closed;
    const messages = stdout
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(messages.length, 3);
    assert.equal(JSON.parse(messages[0].result.content[0].text).passed, true);
    for (const response of messages.slice(1)) {
      assert.equal(response.error.code, -32602);
      assert.match(response.error.message, /inside the bot project/);
    }
    assert.equal(stderr, "");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    await rm(workspace, { recursive: true, force: true });
  }
});
test("stdio MCP handshake and local tools return structured evidence", async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../src/cli.js", import.meta.url)), "mcp"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (x) => (stdout += x));
  child.stderr.on("data", (x) => (stderr += x));
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`MCP exit ${code}: ${stderr}`)),
    );
  });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    for (const req of [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "simulate_interaction", arguments: { name: "ping" } },
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "run_ticket_scenarios", arguments: {} },
      },
    ])
      child.stdin.write(JSON.stringify(req) + "\n");
    child.stdin.end();
    await completed;
    const messages = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(messages.length, 4);
    assert.equal(messages[0].result.serverInfo.name, "discord-bot-kit");
    assert.equal(messages[1].result.tools.length, 7);
    const evidence = JSON.parse(messages[2].result.content[0].text);
    assert.equal(evidence.events[0].type, "reply");
    assert.equal(evidence.diagnostics.length, 0);
    assert.equal(
      JSON.parse(messages[3].result.content[0].text).filter(
        (r: any) => r.passed,
      ).length,
      11,
    );
    assert.equal(stderr, "");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
});
test("MCP custom scenario files and state introspection stay isolated", async () => {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../src/cli.js", import.meta.url)),
      "mcp",
      "--recipe",
      "polls",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (x) => (stdout += x));
  child.stderr.on("data", (x) => (stderr += x));
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Exit ${code}: ${stderr}`)),
    );
  });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const calls = [
      {
        name: "simulate_interaction",
        arguments: {
          name: "poll create",
          args: { question: "Live fixture?", answers: "A | B" },
        },
      },
      { name: "inspect_state", arguments: {} },
      {
        name: "run_scenario",
        arguments: { path: "examples/polls/scenario.json" },
      },
      { name: "inspect_state", arguments: {} },
      {
        name: "autocomplete",
        arguments: { name: "poll show", option: "poll", value: "Live" },
      },
    ];
    calls.forEach((params, index) =>
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: index + 1,
          method: "tools/call",
          params,
        }) + "\n",
      ),
    );
    child.stdin.end();
    await closed;
    const values = stdout
      .trim()
      .split("\n")
      .map((s) => JSON.parse(JSON.parse(s).result.content[0].text));
    assert.equal(
      values[1].state.namespaces.polls.guilds["workshop-guild"].nextId,
      2,
    );
    assert.equal(values[2].passed, true);
    assert.equal(
      values[3].state.namespaces.polls.guilds["workshop-guild"].polls["poll-1"]
        .closed,
      false,
    );
    assert.equal(values[4].choices[0].value, "poll-1");
    assert.equal(stderr, "");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
});
test("MCP rejects null and malformed request objects without losing later requests", async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../src/cli.js", import.meta.url)), "mcp"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  child.stdout.on("data", (x) => (stdout += x));
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Exit ${code}`)),
    );
  });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    child.stdin.end(
      'null\n[]\n{"jsonrpc":"2.0","id":9,"method":null}\n{"jsonrpc":"2.0","id":10,"method":"ping"}\n',
    );
    await closed;
    const result = stdout
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(result.length, 4);
    for (const message of result.slice(0, 3))
      assert.equal(message.error.code, -32600);
    assert.equal(result[3].id, 10);
    assert.deepEqual(result[3].result, {});
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
});

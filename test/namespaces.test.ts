import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { defineNamespace } from "../src/namespaces.js";
import { defineBot } from "../src/core.js";
import { Simulator, input } from "../src/simulate.js";
type Counter = { n: number };
const counter = () =>
  defineNamespace<Counter>({
    name: "counter",
    version: 1,
    initial: { n: 0 },
    validate: (value) =>
      Boolean(
        value &&
          typeof value === "object" &&
          Number.isSafeInteger((value as Counter).n) &&
          (value as Counter).n >= 0,
      ),
  });
test("guild-scoped namespaces isolate values and support an explicit global scope", async () => {
  const store = new Store();
  store.configure([counter()]);
  const a = store.namespace<Counter>("counter", { guildId: "a" }),
    b = store.namespace<Counter>("counter", { guildId: "b" }),
    global = store.namespace<Counter>("counter");
  await a.transact((s) => {
    s.n = 3;
  });
  await global.transact((s) => {
    s.n = 7;
  });
  assert.equal(a.snapshot().n, 3);
  assert.equal(b.snapshot().n, 0);
  assert.equal(global.snapshot().n, 7);
});
test("concurrent namespace increments are atomic and invalid drafts roll back", async () => {
  const store = new Store();
  store.configure([counter()]);
  const state = store.namespace<Counter>("counter", { guildId: "g" });
  await Promise.all(
    Array.from({ length: 50 }, () =>
      state.transact((s) => {
        s.n++;
      }),
    ),
  );
  assert.equal(state.snapshot().n, 50);
  await assert.rejects(
    state.transact((s) => {
      s.n = -1;
    }),
    (e) => (e as any).code === "GW_STATE_INVALID",
  );
  assert.equal(state.snapshot().n, 50);
});
test("retained transaction drafts and returned results cannot mutate committed state", async () => {
  const store = new Store();
  store.configure([counter()]);
  let leaked!: Counter;
  const result = await store.namespace<Counter>("counter").transact((s) => {
    leaked = s;
    s.n = 2;
    return s;
  });
  leaked.n = -99;
  result.n = -80;
  assert.equal(store.namespace<Counter>("counter").snapshot().n, 2);
  let raw: any;
  const output = await store.mutate((s) => {
    raw = s;
    return s;
  });
  raw.nextTicket = -5;
  output.nextTicket = -6;
  assert.equal(store.snapshot().nextTicket, 1);
});
test("durable namespaces restore after restart and unknown schema versions preserve the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "guildwright-namespace-"));
  try {
    const path = join(dir, "state.json");
    const store = new Store(path);
    store.configure([counter()]);
    await store
      .namespace<Counter>("counter", { guildId: "g" })
      .transact((s) => {
        s.n = 9;
      });
    const before = await readFile(path, "utf8");
    const resumed = new Store(path);
    resumed.configure([counter()]);
    await resumed.load();
    assert.equal(
      resumed.namespace<Counter>("counter", { guildId: "g" }).snapshot().n,
      9,
    );
    const upgraded = new Store(path);
    upgraded.configure([{ ...counter(), version: 2 }]);
    await assert.rejects(
      upgraded.load(),
      (e) => (e as any).code === "GW_STATE_VERSION",
    );
    assert.equal(await readFile(path, "utf8"), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("scalar namespaces update explicitly and JSON-invalid values are rejected", async () => {
  const store = new Store();
  store.configure([
    defineNamespace({
      name: "count",
      version: 1,
      initial: 0,
      validate: (v) =>
        typeof v === "number" && Number.isSafeInteger(v) && v >= 0,
    }),
  ]);
  const state = store.namespace<number>("count");
  await state.update((n) => n + 1);
  assert.equal(state.snapshot(), 1);
  await assert.rejects(
    state.transact((n) => n + 1),
    (e) => (e as any).code === "GW_STATE_MUTABILITY",
  );
  assert.throws(
    () =>
      defineNamespace({
        name: "invalid",
        version: 1,
        initial: { n: NaN },
        validate: () => true,
      }),
    (e) => (e as any).code === "GW_STATE_INVALID",
  );
  assert.throws(
    () =>
      defineNamespace({
        name: "invalid",
        version: 1,
        initial: { date: new Date() } as any,
        validate: () => true,
      }),
    (e) => (e as any).code === "GW_STATE_INVALID",
  );
});
test("schema initial defaults and validator inspection cannot create reference leaks", async () => {
  const schema = counter();
  const store = new Store();
  store.configure([schema]);
  schema.initial.n = 999;
  assert.equal(store.namespace<Counter>("counter").snapshot().n, 0);
  assert.throws(
    () => store.namespace("missing"),
    (e) => (e as any).code === "GW_STATE_UNKNOWN",
  );
});
test("ctx.state defaults to guild scope and rejects DMs before writing", async () => {
  const bot = defineBot({
    name: "Counter",
    stateSchemas: [counter()],
    commands: [
      {
        name: "count",
        description: "Increase a count",
        handler: async (ctx) => {
          await ctx.defer();
          const n = await ctx.state<Counter>("counter").transact((s) => ++s.n);
          await ctx.edit({ content: String(n) });
        },
      },
    ],
    routes: [],
  });
  const sim = new Simulator(bot);
  const dm = await sim.run(input("count", { guildId: undefined }));
  assert.equal(dm.diagnostics[0].code, "GW_GUILD_REQUIRED");
  assert.deepEqual(dm.state.namespaces, {});
  await sim.run(input("count"));
  assert.equal(
    sim.store.snapshot().namespaces.counter.guilds["workshop-guild"] &&
      (
        sim.store.snapshot().namespaces.counter.guilds[
          "workshop-guild"
        ] as Counter
      ).n,
    1,
  );
});

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { State, JsonValue, NamespaceSchema } from "./types.js";
import {
  assertJson,
  defineNamespace,
  StateFault,
  validateNamespace,
} from "./namespaces.js";
export const emptyState = (): State => ({
  version: 1,
  tickets: [],
  nextTicket: 1,
  events: [],
  nextEvent: 1,
  namespaces: {},
});
export function validateState(value: unknown): asserts value is State {
  const s = value as State;
  if (
    s &&
    typeof s === "object" &&
    Object.keys(s).some(
      (key) =>
        ![
          "version",
          "tickets",
          "nextTicket",
          "events",
          "nextEvent",
          "namespaces",
        ].includes(key),
    )
  )
    throw new Error(
      "Unknown top-level state field; use a registered namespace",
    );
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.tickets) ||
    !Number.isSafeInteger(s.nextTicket) ||
    s.nextTicket < 1
  )
    throw new Error(
      "Unsupported or corrupted Discord Bot Kit state. Preserve the file and inspect it; it will not be overwritten.",
    );
  const ids = new Set<string>();
  for (const t of s.tickets) {
    if (
      !t ||
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      typeof t.owner !== "string" ||
      typeof t.guildId !== "string" ||
      typeof t.topic !== "string" ||
      !["provisioning", "open", "closing", "closed"].includes(t.status) ||
      typeof t.createdAt !== "string" ||
      (t.channelId !== undefined && typeof t.channelId !== "string")
    )
      throw new Error("Invalid ticket record in state");
    ids.add(t.id);
  }
  if (
    !Array.isArray(s.events) ||
    !Number.isSafeInteger(s.nextEvent) ||
    s.nextEvent < 1
  )
    throw new Error("Invalid signup state");
  const eventIds = new Set<string>();
  for (const e of s.events) {
    if (
      !e ||
      typeof e.id !== "string" ||
      eventIds.has(e.id) ||
      typeof e.guildId !== "string" ||
      typeof e.owner !== "string" ||
      typeof e.title !== "string" ||
      e.title.length < 1 ||
      e.title.length > 120 ||
      !Number.isSafeInteger(e.capacity) ||
      e.capacity < 1 ||
      e.capacity > 1000 ||
      !Array.isArray(e.participants) ||
      e.participants.some((p) => typeof p !== "string") ||
      new Set(e.participants).size !== e.participants.length ||
      e.participants.length > e.capacity ||
      !["open", "closed"].includes(e.status) ||
      typeof e.createdAt !== "string"
    )
      throw new Error("Invalid signup event record");
    eventIds.add(e.id);
  }
  if (
    !s.namespaces ||
    typeof s.namespaces !== "object" ||
    Array.isArray(s.namespaces)
  )
    throw new Error("Invalid namespace state");
  for (const [name, entry] of Object.entries(s.namespaces)) {
    if (
      !/^[a-z][a-z0-9._-]{0,63}$/.test(name) ||
      !entry ||
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1 ||
      !entry.guilds ||
      typeof entry.guilds !== "object" ||
      Array.isArray(entry.guilds)
    )
      throw new Error("Invalid namespace envelope");
    if (entry.global !== undefined) assertJson(entry.global);
    for (const value of Object.values(entry.guilds)) assertJson(value);
  }
}
/** One writer per store. Writes commit only after an atomic rename succeeds. */
export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  private state: State = emptyState();
  private schemas = new Map<string, NamespaceSchema>();
  constructor(readonly path?: string) {}
  async load() {
    if (!this.path) return;
    try {
      const parsed = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as Partial<State>;
      if (
        parsed?.version === 1 &&
        parsed.events === undefined &&
        parsed.nextEvent === undefined
      ) {
        parsed.events = [];
        parsed.nextEvent = 1;
      }
      if (parsed?.version === 1 && parsed.namespaces === undefined)
        parsed.namespaces = {};
      validateState(parsed);
      this.validateSchemas(parsed);
      this.state = parsed;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  snapshot(): State {
    return structuredClone(this.state);
  }
  async restore(value: unknown): Promise<void> {
    const restored = structuredClone(value) as Partial<State>;
    if (
      restored?.version === 1 &&
      restored.events === undefined &&
      restored.nextEvent === undefined
    ) {
      restored.events = [];
      restored.nextEvent = 1;
    }
    if (restored?.version === 1 && restored.namespaces === undefined)
      restored.namespaces = {};
    validateState(restored);
    this.validateSchemas(restored);
    await this.mutate((state) => {
      state.version = restored.version;
      state.tickets = structuredClone(restored.tickets);
      state.nextTicket = restored.nextTicket;
      state.events = structuredClone(restored.events);
      state.nextEvent = restored.nextEvent;
      state.namespaces = structuredClone(restored.namespaces);
    });
  }
  configure(schemas: NamespaceSchema[] = []): void {
    const next = new Map<string, NamespaceSchema>();
    for (const schema of schemas) {
      defineNamespace(schema);
      if (next.has(schema.name))
        throw new Error(`Duplicate namespace schema ${schema.name}`);
      next.set(schema.name, {
        ...schema,
        initial: structuredClone(schema.initial),
      });
    }
    const previous = this.schemas;
    this.schemas = next;
    try {
      this.validateSchemas(this.state);
    } catch (error) {
      this.schemas = previous;
      throw error;
    }
  }
  contracts() {
    return [...this.schemas.values()].map(({ name, version, initial }) => ({
      name,
      version,
      initial: structuredClone(initial),
      scope: "guild by default; explicit global supported",
    }));
  }
  private validateSchemas(state: State) {
    for (const [name, schema] of this.schemas) {
      const entry = Object.hasOwn(state.namespaces, name)
        ? state.namespaces[name]
        : undefined;
      if (!entry) continue;
      if (entry.version !== schema.version)
        throw new StateFault(
          "GW_STATE_VERSION",
          `${name} has stored schema version ${entry.version}; expected ${schema.version}.`,
          "Back up the state and migrate it explicitly; Discord Bot Kit will not overwrite unknown schema versions.",
        );
      if (entry.global !== undefined) validateNamespace(schema, entry.global);
      for (const value of Object.values(entry.guilds))
        validateNamespace(schema, value);
    }
  }
  namespace<T = JsonValue>(
    name: string,
    scope: { guildId?: string } = {},
  ): StateHandle<T> {
    if (!this.schemas.has(name))
      throw new StateFault(
        "GW_STATE_UNKNOWN",
        `Namespace ${name} is not registered.`,
        "Declare a versioned state schema on Bot.stateSchemas before using ctx.state().",
      );
    return new StateHandle<T>(this, name, scope.guildId);
  }
  readNamespace<T>(name: string, guildId?: string): T {
    const schema = this.schemas.get(name);
    if (!schema)
      throw new StateFault(
        "GW_STATE_UNKNOWN",
        `Namespace ${name} is not registered.`,
        "Register the schema before reading state.",
      );
    const envelope = Object.hasOwn(this.state.namespaces, name)
      ? this.state.namespaces[name]
      : undefined;
    const value = guildId
      ? envelope && Object.hasOwn(envelope.guilds, guildId)
        ? envelope.guilds[guildId]
        : undefined
      : envelope?.global;
    return structuredClone(value === undefined ? schema.initial : value) as T;
  }
  async transactNamespace<T, R>(
    name: string,
    guildId: string | undefined,
    fn: (draft: T) => R | Promise<R>,
  ): Promise<R> {
    const schema = this.schemas.get(name);
    if (!schema)
      throw new StateFault(
        "GW_STATE_UNKNOWN",
        `Namespace ${name} is not registered.`,
        "Declare Bot.stateSchemas.",
      );
    return this.mutate(async (state) => {
      if (!Object.hasOwn(state.namespaces, name))
        Object.defineProperty(state.namespaces, name, {
          value: { version: schema.version, guilds: {} },
          enumerable: true,
          writable: true,
          configurable: true,
        });
      const envelope = state.namespaces[name];
      const existing = guildId
        ? Object.hasOwn(envelope.guilds, guildId)
          ? envelope.guilds[guildId]
          : undefined
        : envelope.global;
      const draft = structuredClone(
        existing === undefined ? schema.initial : existing,
      ) as T;
      if (draft === null || typeof draft !== "object")
        throw new StateFault(
          "GW_STATE_MUTABILITY",
          "transact() requires mutable object or array state.",
          "Use update(value => newValue) for scalar state or replacing the root value.",
        );
      const result = await fn(draft);
      validateNamespace(schema, draft);
      if (guildId)
        Object.defineProperty(envelope.guilds, guildId, {
          value: structuredClone(draft),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      else envelope.global = structuredClone(draft);
      return structuredClone(result);
    });
  }
  async updateNamespace<T>(
    name: string,
    guildId: string | undefined,
    fn: (value: T) => T | Promise<T>,
  ): Promise<T> {
    const schema = this.schemas.get(name);
    if (!schema)
      throw new StateFault(
        "GW_STATE_UNKNOWN",
        `Namespace ${name} is not registered.`,
        "Declare Bot.stateSchemas.",
      );
    return this.mutate(async (state) => {
      if (!Object.hasOwn(state.namespaces, name))
        Object.defineProperty(state.namespaces, name, {
          value: { version: schema.version, guilds: {} },
          enumerable: true,
          writable: true,
          configurable: true,
        });
      const envelope = state.namespaces[name];
      const existing = guildId
        ? Object.hasOwn(envelope.guilds, guildId)
          ? envelope.guilds[guildId]
          : undefined
        : envelope.global;
      const next = await fn(
        structuredClone(
          existing === undefined ? schema.initial : existing,
        ) as T,
      );
      validateNamespace(schema, next);
      if (guildId)
        Object.defineProperty(envelope.guilds, guildId, {
          value: structuredClone(next),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      else envelope.global = structuredClone(next);
      return structuredClone(next);
    });
  }
  async mutate<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const draft = this.snapshot();
      const result = structuredClone(await fn(draft));
      const committed = structuredClone(draft);
      validateState(committed);
      this.validateSchemas(committed);
      if (this.path) {
        await mkdir(dirname(this.path), { recursive: true });
        const tmp = this.path + ".tmp";
        await writeFile(tmp, JSON.stringify(committed, null, 2) + "\n", {
          mode: 0o600,
        });
        await rename(tmp, this.path);
      }
      this.state = committed;
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
export class StateHandle<T> {
  constructor(
    private store: Store,
    readonly name: string,
    readonly guildId?: string,
  ) {}
  snapshot(): T {
    return this.store.readNamespace<T>(this.name, this.guildId);
  }
  transact<R>(fn: (draft: T) => R | Promise<R>): Promise<R> {
    return this.store.transactNamespace(this.name, this.guildId, fn);
  }
  update(fn: (value: T) => T | Promise<T>): Promise<T> {
    return this.store.updateNamespace(this.name, this.guildId, fn);
  }
}

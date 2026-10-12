import type { JsonValue, NamespaceSchema } from "./types.js";
export class StateFault extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly remedy: string,
  ) {
    super(message);
  }
}
export function assertJson(value: unknown): asserts value is JsonValue {
  const visiting = new Set<object>();
  function walk(v: unknown, depth: number) {
    if (depth > 64)
      throw new StateFault(
        "GW_STATE_INVALID",
        "State exceeds the supported nesting depth.",
        "Keep namespace state as JSON data with bounded nesting.",
      );
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      return;
    if (
      !v ||
      typeof v !== "object" ||
      (!Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null) ||
      visiting.has(v)
    )
      throw new StateFault(
        "GW_STATE_INVALID",
        "State must contain JSON values without cycles or custom objects.",
        "Convert dates/classes/undefined/NaN to explicit JSON values before committing.",
      );
    if (
      Reflect.ownKeys(v).some(
        (key) =>
          typeof key === "symbol" ||
          ((!Array.isArray(v) || key !== "length") &&
            (!Object.getOwnPropertyDescriptor(v, key)?.enumerable ||
              Boolean(Object.getOwnPropertyDescriptor(v, key)?.get) ||
              Boolean(Object.getOwnPropertyDescriptor(v, key)?.set))),
      )
    )
      throw new StateFault(
        "GW_STATE_INVALID",
        "State cannot contain symbols, accessors or hidden properties.",
        "Use plain enumerable JSON data before committing.",
      );
    visiting.add(v);
    for (const child of Array.isArray(v) ? v : Object.values(v))
      walk(child, depth + 1);
    visiting.delete(v);
  }
  walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > 1_000_000)
    throw new StateFault(
      "GW_STATE_INVALID",
      "A namespace scope exceeds 1 MB.",
      "Partition data or use a transactional database adapter for larger applications.",
    );
}
export function defineNamespace<T>(
  schema: NamespaceSchema<T>,
): NamespaceSchema<T> {
  if (
    !schema ||
    !/^[a-z][a-z0-9._-]{0,63}$/.test(schema.name) ||
    !Number.isSafeInteger(schema.version) ||
    schema.version < 1 ||
    typeof schema.validate !== "function"
  )
    throw new Error(
      "Namespace needs a valid name, positive schema version and validator",
    );
  validateNamespace(schema, schema.initial);
  return schema;
}
export function validateNamespace(
  schema: NamespaceSchema,
  value: unknown,
): asserts value is JsonValue {
  assertJson(value);
  let valid = false;
  try {
    valid = schema.validate(structuredClone(value)) === true;
  } catch {}
  if (!valid)
    throw new StateFault(
      "GW_STATE_INVALID",
      `State for ${schema.name} failed schema validation.`,
      `Correct the ${schema.name} transaction; invalid drafts are rolled back.`,
    );
}
const resourceQueues = new WeakMap<object, Map<string, Promise<unknown>>>();
/** Serialize commits plus message updates for one resource in one process. */
export async function serializeResource<T>(
  owner: object,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  let queues = resourceQueues.get(owner);
  if (!queues) {
    queues = new Map();
    resourceQueues.set(owner, queues);
  }
  const next = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(work);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}

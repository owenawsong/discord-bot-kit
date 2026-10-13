import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { Bot, Execution, Input, State } from "./types.js";
import {
  Simulator,
  input,
  actors,
  type FaultFixture,
  validateFaults,
  validateInput,
} from "./simulate.js";
import { Store } from "./store.js";
export interface Assertions {
  code?: string;
  event?: string;
  contentIncludes?: string;
  ticketCount?: number;
  ticketStatus?: string;
  eventCount?: number;
  eventId?: string;
  eventStatus?: string;
  participantCount?: number;
  clean?: boolean;
  exact?: Record<string, unknown>;
  absent?: string[];
}
export interface Step {
  name?: string;
  kind?: Input["kind"];
  actor?: string;
  args?: Input["args"];
  fields?: Record<string, string>;
  values?: string[];
  dm?: boolean;
  guildId?: string;
  ageMs?: number;
  channelId?: string;
  label?: string;
  saveAs?: string;
  replay?: string;
  faults?: FaultFixture;
  expect: Assertions;
}
export interface Batch {
  label?: string;
  parallel: Step[];
  expect?: Assertions;
}
export interface Scenario {
  name: string;
  steps: (Step | Batch)[];
}
export interface StepResult {
  step: number;
  name: string;
  label?: string;
  group?: string;
  passed: boolean;
  errors: string[];
  detail?: string;
  result: Execution;
}
const captureName = /^[a-z][a-z0-9_-]{0,31}$/;
function validatePointer(path: string) {
  if (
    typeof path !== "string" ||
    (path !== "" && !path.startsWith("/")) ||
    /~(?:[^01]|$)/.test(path)
  )
    throw new Error(`Invalid JSON pointer: ${path}`);
}
export function pointer(value: unknown, path: string): unknown {
  validatePointer(path);
  if (path === "") return value;
  if (!path.startsWith("/"))
    throw new Error(`JSON pointer must start with /: ${path}`);
  let current = value;
  for (const raw of path.slice(1).split("/")) {
    if (/~(?:[^01]|$)/.test(raw))
      throw new Error("Invalid JSON pointer escape");
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key))
      throw new Error(`JSON pointer does not exist: ${path}`);
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function reference(ref: string, captures: Record<string, Execution>) {
  const at = ref.indexOf("#"),
    name = at < 0 ? ref : ref.slice(0, at),
    path = at < 0 ? "" : ref.slice(at + 1);
  if (!captureName.test(name) || !Object.hasOwn(captures, name))
    throw new Error(`Unknown scenario capture: ${name}`);
  return structuredClone(pointer(captures[name], path));
}
function resolveValue(
  value: unknown,
  captures: Record<string, Execution>,
): unknown {
  if (typeof value === "string")
    return value.replace(/\$\{([^}]+)\}/g, (_, ref: string) => {
      const v = reference(ref, captures);
      if (v !== null && typeof v === "object")
        throw new Error("String interpolation needs a primitive capture value");
      return String(v);
    });
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, captures));
  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>;
    if (Object.keys(data).length === 1 && typeof data.$ref === "string")
      return reference(data.$ref, captures);
    return Object.fromEntries(
      Object.entries(data).map(([key, v]) => [key, resolveValue(v, captures)]),
    );
  }
  return value;
}
function validateAssertions(e: Assertions) {
  const allowed = [
    "code",
    "event",
    "contentIncludes",
    "ticketCount",
    "ticketStatus",
    "eventCount",
    "eventId",
    "eventStatus",
    "participantCount",
    "clean",
    "exact",
    "absent",
  ];
  if (
    !e ||
    typeof e !== "object" ||
    Array.isArray(e) ||
    Object.keys(e).length === 0 ||
    Object.keys(e).some((k) => !allowed.includes(k))
  )
    throw new Error("A step needs recognized, nonempty assertions");
  for (const key of ["ticketCount", "eventCount", "participantCount"] as const)
    if (e[key] !== undefined && (!Number.isSafeInteger(e[key]) || e[key]! < 0))
      throw new Error(`Invalid ${key} assertion`);
  if (e.clean !== undefined && typeof e.clean !== "boolean")
    throw new Error("Invalid clean assertion");
  for (const key of [
    "code",
    "event",
    "contentIncludes",
    "ticketStatus",
    "eventId",
    "eventStatus",
  ] as const)
    if (e[key] !== undefined && (typeof e[key] !== "string" || !e[key]))
      throw new Error(`Invalid ${key} assertion`);
  if (
    e.exact !== undefined &&
    (!e.exact ||
      typeof e.exact !== "object" ||
      Array.isArray(e.exact) ||
      Object.keys(e.exact).length === 0 ||
      Object.keys(e.exact).some((p) => !p.startsWith("/")))
  )
    throw new Error("exact assertions map JSON pointers to expected values");
  if (
    e.absent !== undefined &&
    (!Array.isArray(e.absent) ||
      e.absent.some((p) => typeof p !== "string" || !p.startsWith("/")))
  )
    throw new Error("absent assertions need JSON pointer paths");
  for (const path of [...Object.keys(e.exact ?? {}), ...(e.absent ?? [])])
    validatePointer(path);
}
function assertResult(
  e: Assertions,
  target: {
    state: State;
    diagnostics?: Execution["diagnostics"];
    events?: Execution["events"];
    [key: string]: unknown;
  },
): string[] {
  const errors: string[] = [];
  const state = target.state;
  if (e.code && !target.diagnostics?.some((d) => d.code === e.code))
    errors.push(`Expected diagnostic ${e.code}`);
  if (
    e.clean !== undefined &&
    ((target.diagnostics?.length ?? 0) === 0) !== e.clean
  )
    errors.push(
      e.clean
        ? `Expected no diagnostics, got ${target.diagnostics?.map((d) => d.code).join(", ")}`
        : "Expected at least one diagnostic",
    );
  if (e.event && !target.events?.some((v) => v.type === e.event))
    errors.push(`Expected event ${e.event}`);
  if (
    e.contentIncludes &&
    !target.events?.some(
      (v) =>
        v.data &&
        typeof v.data === "object" &&
        "content" in v.data &&
        String(v.data.content).includes(e.contentIncludes!),
    )
  )
    errors.push(`Expected content containing ${e.contentIncludes}`);
  if (e.ticketCount !== undefined && state.tickets.length !== e.ticketCount)
    errors.push(
      `Expected ${e.ticketCount} tickets, got ${state.tickets.length}`,
    );
  if (e.ticketStatus && !state.tickets.some((t) => t.status === e.ticketStatus))
    errors.push(`Expected a ${e.ticketStatus} ticket`);
  const signup = e.eventId
    ? state.events.find((event) => event.id === e.eventId)
    : state.events.at(-1);
  if (e.eventCount !== undefined && state.events.length !== e.eventCount)
    errors.push(`Expected ${e.eventCount} events, got ${state.events.length}`);
  if (e.eventId && !signup) errors.push(`Expected event ${e.eventId}`);
  if (e.eventStatus && signup?.status !== e.eventStatus)
    errors.push(`Expected event status ${e.eventStatus}`);
  if (
    e.participantCount !== undefined &&
    signup?.participants.length !== e.participantCount
  )
    errors.push(
      `Expected ${e.participantCount} participants, got ${signup?.participants.length ?? "no event"}`,
    );
  for (const [path, expected] of Object.entries(e.exact ?? {})) {
    try {
      const actual = pointer(target, path);
      if (!isDeepStrictEqual(actual, expected))
        errors.push(
          `Exact mismatch at ${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
    } catch {
      errors.push(`Exact assertion path missing: ${path}`);
    }
  }
  for (const path of e.absent ?? []) {
    try {
      pointer(target, path);
      errors.push(`Expected absent path: ${path}`);
    } catch {}
  }
  return errors;
}
export function botFingerprint(bot: Bot) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: bot.name,
        commands: bot.commands.map(({ handler, autocomplete, ...c }) => ({
          ...c,
          handler: String(handler),
          autocomplete: autocomplete ? String(autocomplete) : undefined,
        })),
        routes: bot.routes.map(({ handler, ...r }) => ({
          ...r,
          handler: String(handler),
        })),
        schemas: (bot.stateSchemas ?? []).map(({ validate, ...s }) => ({
          ...s,
          validate: String(validate),
        })),
      }),
    )
    .digest("hex");
}
export async function runScenario(bot: Bot, scenario: Scenario) {
  if (
    !scenario ||
    typeof scenario.name !== "string" ||
    scenario.name.length < 1 ||
    scenario.name.length > 200 ||
    !Array.isArray(scenario.steps) ||
    scenario.steps.length < 1 ||
    scenario.steps.length > 200
  )
    throw new Error("Scenario must have a name and 1–200 steps");
  const sim = new Simulator(bot),
    steps: StepResult[] = [],
    captures: Record<string, Execution> = {};
  const batches: {
    step: number;
    label: string;
    passed: boolean;
    errors: string[];
    state: State;
  }[] = [];
  async function executeStep(
    raw: Step,
    refs: Record<string, Execution>,
    group?: string,
  ) {
    const step = resolveValue(raw, refs) as Step;
    if (
      !step ||
      typeof step !== "object" ||
      (typeof step.name !== "string" && !step.replay) ||
      !actors[step.actor ?? "member"]
    )
      throw new Error("Invalid scenario interaction step");
    validateAssertions(step.expect);
    if (step.faults) validateFaults(step.faults);
    if (
      step.saveAs &&
      (!captureName.test(step.saveAs) || Object.hasOwn(captures, step.saveAs))
    )
      throw new Error(`Invalid or duplicate capture ${step.saveAs}`);
    let value: Input;
    if (step.replay) {
      const captured = reference(step.replay, refs) as Execution;
      if (!captured?.input)
        throw new Error("Replay needs a captured execution");
      value = structuredClone(captured.input);
      if (step.name) value.name = step.name;
      for (const key of [
        "kind",
        "fields",
        "args",
        "values",
        "channelId",
        "ageMs",
      ] as const)
        if (Object.hasOwn(step, key)) (value as any)[key] = step[key];
      if (step.actor) value.actor = actors[step.actor];
      if (Object.hasOwn(step, "guildId")) value.guildId = step.guildId;
      if (step.dm) value.guildId = undefined;
    } else
      value = input(step.name!, {
        kind: step.kind ?? "command",
        actor: actors[step.actor ?? "member"],
        fields: step.fields,
        args: step.args,
        values: step.values,
        guildId: step.dm ? undefined : (step.guildId ?? "workshop-guild"),
        channelId: step.channelId ?? "lobby",
        ageMs: step.ageMs,
      });
    const result = await sim.run(value, step.faults);
    const errors = assertResult(
      step.expect,
      result as typeof result & { [key: string]: unknown },
    );
    return { step, name: value.name, result, errors, group };
  }
  for (const [index, item] of scenario.steps.entries()) {
    if ("parallel" in item) {
      if (
        !Array.isArray(item.parallel) ||
        item.parallel.length < 1 ||
        item.parallel.length > 50
      )
        throw new Error("Parallel batches need 1–50 interaction steps");
      const refs = structuredClone(captures);
      const capturesInBatch = item.parallel
        .map((s) => s.saveAs)
        .filter(Boolean);
      if (new Set(capturesInBatch).size !== capturesInBatch.length)
        throw new Error("Duplicate capture inside parallel batch");
      const group = item.label ?? `Parallel batch ${index + 1}`;
      const results = await Promise.all(
        item.parallel.map((s) => executeStep(s, refs, group)),
      );
      for (const result of results) {
        steps.push({
          step: steps.length + 1,
          name: result.name,
          label: result.step.label,
          group,
          passed: result.errors.length === 0,
          errors: result.errors,
          result: result.result,
        });
        if (result.step.saveAs)
          captures[result.step.saveAs] = structuredClone(result.result);
      }
      if (item.expect) {
        validateAssertions(item.expect);
        const target = {
          state: sim.store.snapshot(),
          diagnostics: results.flatMap((r) => r.result.diagnostics),
          events: results.flatMap((r) => r.result.events),
        };
        const errors = assertResult(
          resolveValue(item.expect, captures) as Assertions,
          target,
        );
        batches.push({
          step: index + 1,
          label: group,
          passed: !errors.length,
          errors,
          state: target.state,
        });
      }
    } else {
      const result = await executeStep(item, captures);
      steps.push({
        step: steps.length + 1,
        name: result.name,
        label: item.label,
        passed: !result.errors.length,
        errors: result.errors,
        result: result.result,
      });
      if (result.step.saveAs)
        captures[result.step.saveAs] = structuredClone(result.result);
    }
    if (steps.length > 500)
      throw new Error("Scenario exceeds 500 interactions");
  }
  return {
    format: "discord-bot-kit.scenario",
    version: 1,
    toolVersion: "0.2.1",
    name: scenario.name,
    passed: steps.every((s) => s.passed) && batches.every((b) => b.passed),
    steps: steps.map((s) => ({
      ...s,
      detail: s.errors.join("; ") || "Passed",
    })),
    batches,
    captures,
    finalState: sim.store.snapshot(),
    scenario: structuredClone(scenario),
    bot: { name: bot.name, fingerprint: botFingerprint(bot) },
    scenarioHash: createHash("sha256")
      .update(JSON.stringify(scenario))
      .digest("hex"),
    createdAt: new Date().toISOString(),
  };
}
export async function replayEvidence(bot: Bot, value: unknown) {
  const evidence = value as {
    format?: string;
    version?: number;
    scenario?: Scenario;
    initialState?: unknown;
    executions?: { input: unknown; simulation?: { faults?: FaultFixture } }[];
    bot?: { fingerprint?: string };
  };
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
    throw new Error("Evidence must be an object");
  if (
    evidence.format !== undefined &&
    (![
      "discord-bot-kit.session",
      "discord-bot-kit.scenario",
      "guildwright.session",
      "guildwright.scenario",
    ].includes(evidence.format) ||
      evidence.version !== 1)
  )
    throw new Error("Unsupported Discord Bot Kit evidence format/version");
  const fingerprints = {
    sourceFingerprint: evidence.bot?.fingerprint,
    currentFingerprint: botFingerprint(bot),
  };
  if (
    ["discord-bot-kit.scenario", "guildwright.scenario"].includes(
      evidence.format ?? "",
    ) &&
    evidence.scenario
  )
    return {
      ...(await runScenario(bot, evidence.scenario)),
      environment: "isolated-scenario-replay",
      ...fingerprints,
    };
  if (
    !Array.isArray(evidence.executions) ||
    evidence.executions.length < 1 ||
    evidence.executions.length > 200
  )
    throw new Error("Replay expects 1–200 evidence executions");
  for (const execution of evidence.executions) {
    validateInput(execution?.input);
    if (execution.simulation?.faults)
      validateFaults(execution.simulation.faults);
  }
  const store = new Store();
  store.configure(bot.stateSchemas);
  if (evidence.initialState !== undefined)
    await store.restore(evidence.initialState);
  const sim = new Simulator(bot, store),
    results = [];
  for (const execution of evidence.executions)
    results.push(
      await sim.run(execution.input as Input, execution.simulation?.faults),
    );
  return {
    environment: "isolated-local-replay",
    results,
    state: sim.store.snapshot(),
    ...fingerprints,
  };
}

import type {
  Bot,
  Diagnostic,
  Event,
  Execution,
  Input,
  JsonValue,
  Message,
  Modal,
  Permission,
  Port,
} from "./types.js";
import { Store } from "./store.js";
import {
  OptionFault,
  validateArguments,
  validateOptionSchema,
} from "./options.js";
import {
  defineNamespace,
  serializeResource,
  StateFault,
} from "./namespaces.js";
import { validateMessage, MessageFault } from "./messages.js";
export class Fault extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly remedy: string,
  ) {
    super(message);
  }
}
function outputModal(m: Modal) {
  if (
    !m ||
    typeof m.id !== "string" ||
    m.id.length < 1 ||
    m.id.length > 100 ||
    typeof m.title !== "string" ||
    m.title.length < 1 ||
    m.title.length > 45 ||
    !Array.isArray(m.fields) ||
    m.fields.length < 1 ||
    m.fields.length > 5 ||
    m.fields.some(
      (f) =>
        !f ||
        typeof f.id !== "string" ||
        f.id.length < 1 ||
        f.id.length > 100 ||
        typeof f.label !== "string" ||
        f.label.length < 1 ||
        f.label.length > 45 ||
        (f.maxLength !== undefined &&
          (!Number.isInteger(f.maxLength) ||
            f.maxLength < 1 ||
            f.maxLength > 4000)),
    ) ||
    new Set(m.fields.map((f) => f.id)).size !== m.fields.length
  )
    throw new Fault(
      "GW_OUTPUT_INVALID",
      "The modal payload exceeds supported Discord limits.",
      "Use a title/labels up to 45 characters, unique IDs up to 100 characters, and one to five fields.",
    );
}
export class Context {
  readonly events: Event[] = [];
  readonly diagnostics: Diagnostic[] = [];
  private acknowledgement: "none" | "deferred" | "replied" | "modal" = "none";
  readonly started = Date.now();
  constructor(
    readonly input: Input,
    readonly store: Store,
    readonly port: Port,
  ) {}
  get args(): Readonly<NonNullable<Input["args"]>> {
    return this.input.args ?? {};
  }
  state<T = JsonValue>(
    name: string,
    options: { scope?: "guild" | "global" } = {},
  ) {
    return this.store.namespace<T>(
      name,
      options.scope === "global" ? {} : { guildId: this.requireGuild() },
    );
  }
  serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    return serializeResource(
      this.store,
      `${this.input.guildId ?? "global"}:${key}`,
      work,
    );
  }
  get acknowledged() {
    return this.acknowledgement !== "none";
  }
  require(permission: Permission) {
    if (!this.input.actor.permissions.includes(permission))
      throw new Fault(
        "GW_PERMISSION_DENIED",
        `This action requires ${permission}.`,
        `Check ${permission} inside the component handler as well as the command.`,
      );
  }
  requireGuild() {
    if (!this.input.guildId)
      throw new Fault(
        "GW_GUILD_REQUIRED",
        "This action is only available in a server.",
        "Reject direct-message interactions before changing server state.",
      );
    return this.input.guildId;
  }
  private initial() {
    if (this.acknowledged)
      throw new Fault(
        "GW_DOUBLE_ACK",
        "This interaction already has an initial response.",
        "After defer(), use edit(); after reply(), use followup().",
      );
    if ((this.input.ageMs ?? 0) + Date.now() - this.started >= 3000)
      throw new Fault(
        "GW_ACK_TIMEOUT",
        "The initial response missed the three-second interaction window.",
        "Call defer() before network or storage work.",
      );
  }
  private async emit(type: Event["type"], data: unknown) {
    await this.port.send(type, data);
    this.events.push({ type, data, at: Date.now() - this.started });
  }
  async reply(message: Message) {
    this.initial();
    validateMessage(message);
    this.acknowledgement = "replied";
    await this.emit("reply", message);
  }
  async defer(ephemeral = true) {
    this.initial();
    this.acknowledgement = "deferred";
    await this.emit("defer", { ephemeral });
  }
  async deferUpdate() {
    this.initial();
    if (!["button", "select"].includes(this.input.kind))
      throw new Fault(
        "GW_UPDATE_CONTEXT",
        "Only button or select interactions can defer a message update.",
        "Use defer() for commands and modal submissions.",
      );
    this.acknowledgement = "deferred";
    await this.emit("deferUpdate", {});
  }
  async edit(message: Message) {
    if (
      this.acknowledgement !== "deferred" &&
      this.acknowledgement !== "replied"
    )
      throw new Fault(
        "GW_EDIT_BEFORE_ACK",
        "Cannot edit an interaction before its initial acknowledgement.",
        "Call reply() or defer() first.",
      );
    validateMessage(message);
    await this.emit("edit", message);
    this.acknowledgement = "replied";
  }
  async followup(message: Message) {
    if (!this.acknowledged || this.acknowledgement === "modal")
      throw new Fault(
        "GW_FOLLOWUP_BEFORE_ACK",
        "Follow-up requires a message acknowledgement.",
        "Reply or defer before followup().",
      );
    validateMessage(message);
    await this.emit("followup", message);
  }
  async modal(modal: Modal) {
    this.initial();
    outputModal(modal);
    this.acknowledgement = "modal";
    await this.emit("modal", modal);
  }
  async effect(name: string, data: unknown) {
    await this.emit("effect", { name, data });
  }
}
export function defineBot(bot: Bot): Bot {
  const names = new Set<string>();
  for (const c of bot.commands) {
    const parts = c.name.split(" ");
    if (
      parts.length > 3 ||
      parts.some((part) => !/^[a-z][a-z0-9-]{0,31}$/.test(part)) ||
      names.has(c.name) ||
      c.description.length < 1 ||
      c.description.length > 100
    )
      throw new Error(`Invalid or duplicate command: ${c.name}`);
    names.add(c.name);
    validateOptionSchema(c.options);
    if (c.options?.some((o) => o.autocomplete) && !c.autocomplete)
      throw new Error(
        `Command ${c.name} declares autocomplete without a handler`,
      );
  }
  for (const name of names)
    for (const other of names)
      if (name !== other && other.startsWith(name + " "))
        throw new Error(`A command cannot also be a command group: ${name}`);
  for (const r of bot.routes)
    if (!r.prefix) throw new Error("Route prefix cannot be empty");
  const schemaNames = new Set<string>();
  for (const schema of bot.stateSchemas ?? []) {
    defineNamespace(schema);
    if (schemaNames.has(schema.name))
      throw new Error(`Duplicate namespace ${schema.name}`);
    schemaNames.add(schema.name);
  }
  return bot;
}
export async function execute(
  bot: Bot,
  input: Input,
  store: Store,
  port: Port,
): Promise<Execution> {
  const ctx = new Context(input, store, port);
  try {
    const handler =
      input.kind === "command"
        ? bot.commands.find((c) => c.name === input.name)
        : bot.routes
            .filter(
              (r) => r.kind === input.kind && input.name.startsWith(r.prefix),
            )
            .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (!handler)
      throw new Fault(
        "GW_UNKNOWN_ROUTE",
        `No ${input.kind} handler for ${input.name}.`,
        "Register the command or component prefix in defineBot().",
      );
    if (handler.permission) ctx.require(handler.permission);
    if (input.kind === "command" && "name" in handler)
      input.args = validateArguments(handler.options, input.args);
    await handler.handler(ctx);
    if (!ctx.acknowledged)
      throw new Fault(
        "GW_NO_ACK",
        "The handler finished without acknowledging the interaction.",
        "Reply, defer, or show a modal on every path.",
      );
  } catch (e) {
    const fault =
      e instanceof Fault ||
      e instanceof OptionFault ||
      e instanceof StateFault ||
      e instanceof MessageFault
        ? e
        : new Fault(
            "GW_HANDLER_ERROR",
            "The handler failed.",
            "Inspect the server error privately; do not expose tokens or exception messages in replies.",
          );
    ctx.diagnostics.push({
      code: fault.code,
      severity: "error",
      message: fault.message,
      remedy: fault.remedy,
    });
    if (fault.code !== "GW_ACK_TIMEOUT")
      try {
        if (!ctx.acknowledged)
          await ctx.reply({ content: fault.message, ephemeral: true });
        else await ctx.followup({ content: fault.message, ephemeral: true });
      } catch {
        /* A failed response is preserved by the original diagnostic. */
      }
  }
  return {
    input,
    events: ctx.events,
    diagnostics: ctx.diagnostics,
    elapsedMs: Date.now() - ctx.started,
    state: store.snapshot(),
  };
}

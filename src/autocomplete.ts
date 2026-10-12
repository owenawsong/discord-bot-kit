import type {
  AutocompleteInput,
  Bot,
  Diagnostic,
  JsonValue,
  Suggestion,
} from "./types.js";
import { Store } from "./store.js";
import { validateArguments, OptionFault } from "./options.js";
import { StateFault } from "./namespaces.js";
export class AutocompleteContext {
  constructor(
    readonly input: AutocompleteInput,
    private store: Store,
  ) {}
  get args() {
    return this.input.args ?? {};
  }
  get focused() {
    return { name: this.input.option, value: this.input.value };
  }
  state<T = JsonValue>(
    name: string,
    options: { scope?: "guild" | "global" } = {},
  ) {
    if (options.scope !== "global" && !this.input.guildId)
      throw new StateFault(
        "GW_GUILD_REQUIRED",
        "Guild-scoped state needs a server interaction.",
        "Reject direct-message state lookups or explicitly choose global scope.",
      );
    const handle = this.store.namespace<T>(
      name,
      options.scope === "global" ? {} : { guildId: this.input.guildId },
    );
    return Object.freeze({ snapshot: () => handle.snapshot() });
  }
}
export async function runAutocomplete(
  bot: Bot,
  input: AutocompleteInput,
  store: Store,
) {
  const started = Date.now();
  const diagnostics: Diagnostic[] = [];
  let choices: Suggestion[] = [];
  const fault = (code: string, message: string, remedy: string) => {
    const e = new OptionFault(code, message);
    Object.defineProperty(e, "remedy", { value: remedy });
    throw e;
  };
  try {
    if ((input.ageMs ?? 0) >= 3000)
      fault(
        "GW_ACK_TIMEOUT",
        "Autocomplete interaction has expired.",
        "Keep autocomplete local and fast; Discord does not support deferring it.",
      );
    const command = bot.commands.find((c) => c.name === input.name),
      option = command?.options?.find((o) => o.name === input.option);
    if (!command?.autocomplete || !option?.autocomplete)
      fault(
        "GW_AUTOCOMPLETE_UNKNOWN",
        "No autocomplete handler for this command option.",
        "Declare option.autocomplete and command.autocomplete together.",
      );
    if (
      command!.permission &&
      !input.actor.permissions.includes(command!.permission)
    )
      fault(
        "GW_PERMISSION_DENIED",
        "This autocomplete requires the command permission.",
        "Apply the same permission check to suggestions and command execution.",
      );
    if (typeof input.value !== "string" && typeof input.value !== "number")
      fault(
        "GW_ARGUMENT_TYPE",
        "Focused autocomplete value must be string or number.",
        "Pass the unfinished focused value separately from completed arguments.",
      );
    const args = { ...input.args };
    delete args[input.option];
    const options = command!
      .options!.filter((o) => o.name !== input.option)
      .map((o) => ({ ...o, required: false }));
    input = { ...input, args: validateArguments(options, args) };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      choices = await Promise.race([
        command!.autocomplete!(new AutocompleteContext(input, store)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new OptionFault(
                  "GW_AUTOCOMPLETE_TIMEOUT",
                  "Autocomplete did not finish before its response deadline.",
                ),
              ),
            Math.max(1, 2500 - (input.ageMs ?? 0)),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (
      !Array.isArray(choices) ||
      choices.length > 25 ||
      choices.some(
        (c) =>
          !c ||
          typeof c.name !== "string" ||
          c.name.length < 1 ||
          c.name.length > 100 ||
          (option!.type === "string"
            ? typeof c.value !== "string" ||
              c.value.length < 1 ||
              c.value.length > 100
            : typeof c.value !== "number" ||
              !Number.isFinite(c.value) ||
              Math.abs(c.value) > Number.MAX_SAFE_INTEGER ||
              (option!.type === "integer" && !Number.isSafeInteger(c.value))),
      ) ||
      new Set(choices.map((c) => c.value)).size !== choices.length
    )
      fault(
        "GW_AUTOCOMPLETE_OUTPUT",
        "Autocomplete must return at most 25 correctly typed, unique suggestions.",
        "Use names/strings up to 100 characters and finite numbers matching the option type.",
      );
    try {
      for (const choice of choices)
        validateArguments(
          [{ ...option!, required: false, autocomplete: false }],
          { [input.option]: choice.value },
        );
    } catch {
      fault(
        "GW_AUTOCOMPLETE_OUTPUT",
        "An autocomplete suggestion violates the option bounds.",
        "Return values that the final command option accepts.",
      );
    }
    if ((input.ageMs ?? 0) + Date.now() - started >= 3000)
      fault(
        "GW_AUTOCOMPLETE_TIMEOUT",
        "Autocomplete exceeded the initial-response deadline.",
        "Avoid blocking work in autocomplete; precompute expensive suggestions.",
      );
  } catch (e) {
    choices = [];
    const known = e instanceof OptionFault || e instanceof StateFault;
    diagnostics.push({
      code: known ? e.code : "GW_AUTOCOMPLETE_ERROR",
      severity: "error",
      message: known ? e.message : "Autocomplete handler failed.",
      remedy: known
        ? e.remedy
        : "Inspect the autocomplete handler privately; return suggestions without remote side effects.",
    });
  }
  return { input, choices, diagnostics, elapsedMs: Date.now() - started };
}

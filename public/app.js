"use strict";
let session = "",
  history = [],
  commands = [],
  botName = "",
  contract = null,
  latestState = null,
  pending = false,
  pendingCommand = null,
  pendingModal = null,
  selectedExecution = -1;
const $ = (id) => document.getElementById(id),
  node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
async function api(path, data) {
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers:
      data === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-Guildwright-Session": session,
          },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Request failed");
  return result;
}
function selection() {
  return {
    actor: $("actor").value,
    ageMs: Number($("latency").value),
    dm: $("dm").checked,
    channelId: $("channel").value,
  };
}
function status(value) {
  $("status").textContent = value;
}
function download(name, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const a = node("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function view(name) {
  if (!["workshop", "scenarios", "contract", "launch"].includes(name))
    name = "workshop";
  historyState(name);
  for (const tab of document.querySelectorAll("[data-view]")) {
    tab.classList.toggle("active", tab.dataset.view === name);
    tab.setAttribute("aria-selected", String(tab.dataset.view === name));
  }
  for (const panel of document.querySelectorAll(".view"))
    panel.classList.toggle("hidden", panel.id !== name + "-view");
}
function historyState(name) {
  window.history.replaceState(null, "", "#" + name);
}
window.addEventListener("hashchange", () => view(location.hash.slice(1)));
function inspectTab(name) {
  for (const tab of document.querySelectorAll("[data-inspect]"))
    tab.classList.toggle("active", tab.dataset.inspect === name);
  for (const panel of document.querySelectorAll(".inspect-view"))
    panel.classList.toggle("hidden", panel.id !== name + "-inspect");
}
function safeLink(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function renderMessage(type, message, execution, replace) {
  if (replace && message.ephemeral === undefined)
    message = { ...message, ephemeral: replace.dataset.private === "true" };
  const article = node("article", "message");
  article.dataset.private = String(!!message.ephemeral);
  article.append(node("div", "avatar", "g"));
  const body = node("div");
  const header = node("header");
  header.append(
    node("strong", "", botName),
    node("span", "", type.toUpperCase()),
  );
  body.append(header);
  if (message.content) body.append(node("div", "content", message.content));
  if (message.ephemeral)
    body.append(
      node("div", "private", "Visible to the invoking member in Discord"),
    );
  for (const embed of message.embeds || []) {
    const box = node("div", "embed");
    if (embed.author?.name) box.append(node("small", "", embed.author.name));
    if (embed.title) {
      const url = safeLink(embed.url);
      const title = node(url ? "a" : "strong", "", embed.title);
      if (url) {
        title.href = url;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
      }
      box.append(title);
    }
    if (embed.description) box.append(node("p", "", embed.description));
    const fields = node("div", "embed-fields");
    for (const f of embed.fields || []) {
      const field = node("div");
      field.append(node("strong", "", f.name), node("p", "", f.value));
      fields.append(field);
    }
    box.append(fields);
    if (embed.footer?.text) box.append(node("small", "", embed.footer.text));
    if (embed.image || embed.thumbnail)
      box.append(
        node(
          "small",
          "",
          "Remote image specified; inspect its URL in execution JSON.",
        ),
      );
    body.append(box);
  }
  if (message.buttons?.length) {
    const actions = node("div", "message-actions");
    for (const b of message.buttons) {
      const button = node("button", b.style || "", b.label);
      button.dataset.component = b.id;
      button.onclick = () => run(b.id, "button", {}, article);
      actions.append(button);
    }
    body.append(actions);
  }
  if (message.select) {
    const select = node("select");
    select.dataset.component = message.select.id;
    select.setAttribute("aria-label", message.select.placeholder);
    const placeholder = node("option", "", message.select.placeholder);
    placeholder.value = "";
    select.append(placeholder);
    for (const item of message.select.options) {
      const option = node("option", "", item.label);
      option.value = item.value;
      select.append(option);
    }
    select.onchange = () =>
      select.value &&
      run(message.select.id, "select", { values: [select.value] }, article);
    body.append(select);
  }
  article.append(body);
  if (replace?.isConnected) replace.replaceWith(article);
  else $("messages").append(article);
  return article;
}
function renderRequest(input) {
  const article = node("article", "message request");
  article.append(node("div", "avatar", input.actor.name.slice(0, 1)));
  const content = node("div");
  content.append(
    node(
      "div",
      "content",
      `${input.actor.name} → ${input.kind === "command" ? "/" : ""}${input.name}`,
    ),
  );
  if (input.args && Object.keys(input.args).length)
    content.append(node("small", "muted", JSON.stringify(input.args)));
  article.append(content);
  $("messages").append(article);
}
function showModal(data, actor) {
  pendingModal = { data, actor };
  $("modal-title").textContent = data.title;
  $("modal-fields").replaceChildren();
  for (const f of data.fields) {
    const label = node("label", "", f.label),
      field = node("textarea");
    field.name = f.id;
    field.required = f.required ?? true;
    field.maxLength = f.maxLength || 1000;
    field.minLength = f.minLength || 0;
    label.append(field);
    $("modal-fields").append(label);
  }
  $("modal-dialog").showModal();
}
function renderEvents(result, interactive = true, target = null) {
  const updatesComponent = result.events.some((e) => e.type === "deferUpdate");
  if (!target && updatesComponent) {
    target = [...$("messages").querySelectorAll("[data-component]")]
      .filter((e) => e.dataset.component === result.input.name)
      .at(-1)
      ?.closest("article");
  }
  let initial = null;
  renderRequest(result.input);
  for (const event of result.events) {
    if (["reply", "edit", "followup"].includes(event.type)) {
      const rendered = renderMessage(
        event.type,
        event.data,
        result,
        event.type === "edit" ? (updatesComponent ? target : initial) : null,
      );
      if (event.type !== "followup") initial = rendered;
      if (event.type === "edit" && updatesComponent) target = rendered;
    } else if (event.type === "modal" && interactive)
      showModal(event.data, {
        actor: actorKey(result.input.actor),
        channelId: result.input.channelId,
        dm: !result.input.guildId,
        ageMs: 0,
      });
    else
      $("messages").append(
        node(
          "p",
          "event",
          `${event.type} · ${event.data?.name || event.data?.title || "interaction acknowledged"}`,
        ),
      );
  }
  $("messages").scrollTop = $("messages").scrollHeight;
}
function flatten(value, path = "", out = {}) {
  if (value === null || typeof value !== "object") {
    out[path || "/"] = value;
    return out;
  }
  const keys = Object.keys(value);
  out[path || "/"] = Array.isArray(value)
    ? { container: "array", length: value.length }
    : { container: "object" };
  for (const k of keys)
    flatten(
      value[k],
      path + "/" + k.replace(/~/g, "~0").replace(/\//g, "~1"),
      out,
    );
  return out;
}
function diff(before, after) {
  $("state-diff").replaceChildren();
  if (!before) {
    $("state-diff").append(
      node(
        "p",
        "muted",
        "Previous snapshot unavailable for this reconnected execution.",
      ),
    );
    return;
  }
  const a = flatten(before),
    b = flatten(after),
    changes = Object.keys({ ...a, ...b }).filter(
      (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
    );
  if (!changes.length)
    $("state-diff").append(
      node("p", "muted", "No changes since the previous snapshot."),
    );
  for (const k of changes.slice(0, 80)) {
    const row = node("div", "diff-row");
    row.append(
      node("div", "diff-path", k),
      node(
        "div",
        "diff-before",
        "− " + (a[k] === undefined ? "absent" : JSON.stringify(a[k])),
      ),
      node(
        "div",
        "diff-after",
        "+ " + (b[k] === undefined ? "absent" : JSON.stringify(b[k])),
      ),
    );
    $("state-diff").append(row);
  }
  if (changes.length > 80)
    $("state-diff").append(
      node(
        "p",
        "muted",
        `${changes.length - 80} more changes in complete state JSON.`,
      ),
    );
}
function renderState(value, current = false) {
  if (current) {
    latestState = value;
    const selected = $("channel").value;
    $("channel").replaceChildren();
    const lobby = node("option", "", "Lobby");
    lobby.value = "lobby";
    $("channel").append(lobby);
    for (const t of value.tickets || []) {
      if (!t.channelId) continue;
      const o = node("option", "", `${t.id} / ${t.status}`);
      o.value = t.channelId;
      $("channel").append(o);
    }
    if ([...$("channel").options].some((o) => o.value === selected))
      $("channel").value = selected;
  }
  $("ticket-count").textContent = (value.tickets || []).length;
  $("tickets").replaceChildren();
  for (const t of value.tickets || []) {
    const row = node("div", "ticket-row");
    const h = node("header");
    h.append(node("span", "", t.id), node("span", "state", t.status));
    row.append(h, node("p", "", t.topic), node("p", "", `Owner ${t.owner}`));
    $("tickets").append(row);
  }
  if (!value.tickets?.length)
    $("tickets").append(node("p", "muted", "No tickets."));
  $("event-count").textContent = (value.events || []).length;
  $("events").replaceChildren();
  for (const e of value.events || []) {
    const row = node("div", "ticket-row"),
      h = node("header");
    h.append(node("span", "", e.id), node("span", "state", e.status));
    row.append(
      h,
      node("p", "", e.title),
      node("p", "", `${e.participants.length}/${e.capacity} places filled`),
    );
    $("events").append(row);
  }
  if (!value.events?.length)
    $("events").append(node("p", "muted", "No signup events."));
  $("namespaces").replaceChildren();
  for (const [name, entry] of Object.entries(value.namespaces || {})) {
    const row = node("details", "raw");
    row.append(
      node("summary", "", `${name} · schema ${entry.version}`),
      node("pre", "", JSON.stringify(entry, null, 2)),
    );
    $("namespaces").append(row);
  }
  if (!Object.keys(value.namespaces || {}).length)
    $("namespaces").append(
      node(
        "p",
        "muted",
        contract?.stateSchemas?.length
          ? "No values materialized yet. See declared schemas in Bot contract."
          : "No custom state schemas declared.",
      ),
    );
  $("state-output").textContent = JSON.stringify(value, null, 2);
}
function inspectExecution(index) {
  selectedExecution = index;
  const r = history[index];
  if (!r) return;
  $("run-count").textContent = history.length;
  $("diagnostics").replaceChildren();
  if (!r.diagnostics.length)
    $("diagnostics").append(
      node(
        "p",
        "good",
        `✓ Acknowledged · ${r.elapsedMs.toFixed(1)} ms local handler time`,
      ),
    );
  for (const d of r.diagnostics) {
    const box = node("div", "diagnostic");
    box.append(
      node("code", "", d.code),
      node("p", "", d.message),
      node("p", "remedy", d.remedy),
    );
    $("diagnostics").append(box);
  }
  $("lifecycle").replaceChildren();
  for (const e of r.events) {
    const row = node("div", "timeline-row");
    row.append(
      node("span", "", `${e.at.toFixed(1)} ms`),
      node("strong", "", e.type),
    );
    $("lifecycle").append(row);
  }
  diff(r.uiBefore, index >= 0 ? r.state : {});
  renderState(r.state);
  $("raw-output").textContent = JSON.stringify(r, null, 2);
  renderHistory();
}
function renderHistory() {
  $("execution-history").replaceChildren();
  history.forEach((r, i) => {
    const b = node(
      "button",
      "history-button" + (i === selectedExecution ? " active" : ""),
    );
    b.append(
      node("span", "", `${i + 1}. ${r.input.name}`),
      node(
        "small",
        "",
        `${r.input.actor.name} · ${r.input.kind} · ${r.diagnostics.length ? "diagnostic" : "clean"} · ${r.elapsedMs.toFixed(1)} ms`,
      ),
    );
    b.onclick = () => {
      inspectExecution(i);
      inspectTab("trace");
    };
    $("execution-history").append(b);
  });
  $("capture-scenario").disabled = !history.length;
  $("capture-note").textContent = history.length
    ? "Review inferred assertions before using this as a regression test."
    : "Capture after running an interaction.";
}
async function run(name, kind = "command", extra = {}, target = null) {
  if (pending) return;
  pending = true;
  $("send-command").disabled = true;
  status("");
  const before = structuredClone(latestState);
  if ($("messages").querySelector(".empty")) $("messages").replaceChildren();
  try {
    const r = await api("run", { name, kind, ...selection(), ...extra });
    r.uiBefore = before;
    history.push(r);
    renderEvents(r, true, target);
    renderState(r.state, true);
    inspectExecution(history.length - 1);
  } catch (e) {
    status(e.message);
  } finally {
    pending = false;
    $("send-command").disabled = false;
  }
}
function renderCommands() {
  const q = $("command-search").value.toLowerCase();
  $("commands").replaceChildren();
  for (const c of commands.filter((c) =>
    (c.name + " " + c.description).toLowerCase().includes(q),
  )) {
    const b = node("button");
    b.append(node("span", "slash", "/"));
    const body = node("span", "command-body");
    body.append(node("span", "", c.name), node("small", "", c.description));
    b.append(body);
    b.onclick = () => {
      $("command-input").value = c.name;
      requestCommand(c.name);
    };
    $("commands").append(b);
  }
  $("command-count").textContent = commands.length;
}
function requestCommand(name) {
  if (pending) {
    status("An interaction is running. Wait for its execution trace.");
    return;
  }
  const command = commands.find((c) => c.name === name);
  if (!command) {
    status(`No command named /${name}. Choose one from the loaded contract.`);
    return;
  }
  if (!command.options?.length) return run(name);
  pendingCommand = { command, actor: selection() };
  $("args-title").textContent = "/" + command.name;
  $("args-description").textContent = command.description;
  $("args-fields").replaceChildren();
  for (const o of command.options) {
    const label = node(
      "label",
      "",
      o.name + (o.required ? " *" : " (optional)"),
    );
    let field;
    if (o.choices || o.type === "boolean") {
      field = node("select");
      const empty = node(
        "option",
        "",
        o.required ? "Choose a value" : "Not specified",
      );
      empty.value = "";
      field.append(empty);
      (
        o.choices || [
          { name: "True", value: true },
          { name: "False", value: false },
        ]
      ).forEach((c, i) => {
        const option = node("option", "", c.name);
        option.value = String(i);
        field.append(option);
      });
    } else {
      field = node("input");
      field.type = ["number", "integer"].includes(o.type) ? "number" : "text";
      field.step = o.type === "integer" ? "1" : "any";
      if (o.min !== undefined) field.min = o.min;
      if (o.max !== undefined) field.max = o.max;
      if (o.minLength !== undefined) field.minLength = o.minLength;
      if (o.maxLength !== undefined) field.maxLength = o.maxLength;
      if (["user", "channel"].includes(o.type)) {
        field.pattern = "[0-9]{17,22}";
        field.placeholder = "Discord ID";
      }
      if (o.name === "event" && latestState?.events?.length)
        field.value = latestState.events.at(-1).id;
      if (o.autocomplete) {
        const list = node("datalist");
        list.id = "complete-" + o.name;
        field.setAttribute("list", list.id);
        let timer,
          request = 0;
        field.oninput = () => {
          clearTimeout(timer);
          const revision = ++request,
            owner = pendingCommand;
          timer = setTimeout(async () => {
            if (!owner || pendingCommand !== owner) return;
            try {
              const r = await api("autocomplete", {
                name: command.name,
                option: o.name,
                value: field.value,
                ...owner.actor,
                args: optionValues(command, o.name),
              });
              if (revision !== request || pendingCommand !== owner) return;
              list.replaceChildren();
              for (const choice of r.choices) {
                const item = node("option");
                item.value = String(choice.value);
                item.label = choice.name;
                list.append(item);
              }
            } catch (e) {
              status(e.message);
            }
          }, 160);
        };
        label.append(list);
      }
    }
    field.name = o.name;
    field.required = o.required || false;
    field.setAttribute("aria-label", o.name);
    label.append(
      field,
      node(
        "span",
        "field-help",
        `${o.description} · ${o.type}${o.autocomplete ? " · autocomplete" : ""}`,
      ),
    );
    $("args-fields").append(label);
  }
  $("args-dialog").showModal();
}
function optionValues(command, omit) {
  const data = new FormData($("args-form")),
    args = {};
  for (const o of command.options || []) {
    if (o.name === omit) continue;
    const raw = data.get(o.name);
    if (raw === null || raw === "") continue;
    args[o.name] = o.choices
      ? o.choices[Number(raw)]?.value
      : o.type === "boolean"
        ? raw === "0"
        : ["number", "integer"].includes(o.type)
          ? Number(raw)
          : String(raw);
  }
  return args;
}
function renderContract() {
  for (const id of ["contract-commands", "contract-routes", "contract-state"])
    $(id).replaceChildren();
  for (const c of commands) {
    const box = node("article", "contract-entry");
    box.append(node("h4", "", "/" + c.name), node("p", "", c.description));
    if (c.permission)
      box.append(node("p", "", `Required permission: ${c.permission}`));
    if (c.options?.length)
      box.append(node("pre", "", JSON.stringify(c.options, null, 2)));
    $("contract-commands").append(box);
  }
  for (const r of contract.routes || []) {
    const box = node("article", "contract-entry");
    box.append(
      node("h4", "", `${r.kind} · ${r.prefix}`),
      node(
        "p",
        "",
        r.permission
          ? `Requires ${r.permission}`
          : "Authorization is defined by the handler.",
      ),
    );
    $("contract-routes").append(box);
  }
  if (!contract.routes?.length)
    $("contract-routes").append(
      node("p", "muted", "No component routes supplied in this contract."),
    );
  for (const s of contract.stateSchemas || []) {
    const box = node("article", "contract-entry");
    box.append(
      node("h4", "", `${s.name} · v${s.version}`),
      node("pre", "", JSON.stringify(s, null, 2)),
    );
    $("contract-state").append(box);
  }
  if (!contract.stateSchemas?.length)
    $("contract-state").append(
      node("p", "muted", "No custom state schemas declared."),
    );
}
function actorKey(actor) {
  return actor.id === "mod-1"
    ? "moderator"
    : actor.id === "member-2"
      ? "stranger"
      : "member";
}
function capturedScenario() {
  return {
    name: botName + " / captured session",
    steps: history.map((r, i) => {
      const message = r.events.find(
        (e) => ["reply", "edit", "followup"].includes(e.type) && e.data.content,
      );
      return {
        label: `${i + 1}: ${r.input.name}`,
        name: r.input.name,
        kind: r.input.kind,
        actor: actorKey(r.input.actor),
        args: r.input.args,
        fields: r.input.fields,
        values: r.input.values,
        faults: r.simulation?.faults,
        ageMs: r.input.ageMs,
        channelId: r.input.channelId,
        dm: !r.input.guildId,
        expect: r.diagnostics.length
          ? { code: r.diagnostics[0].code }
          : {
              clean: true,
              ...(message
                ? { contentIncludes: message.data.content.slice(0, 120) }
                : { event: r.events[0]?.type }),
            },
      };
    }),
  };
}
function renderTests(results, overall) {
  $("test-results").replaceChildren();
  const passed = results.filter((r) => r.passed).length;
  $("test-summary").replaceChildren(
    node("strong", "", `${passed} / ${results.length} passed`),
    node(
      "span",
      "",
      overall === false || results.some((r) => !r.passed)
        ? "Inspect failing assertions below."
        : "All declared assertions passed.",
    ),
  );
  $("test-tab-count").textContent = `${passed}/${results.length}`;
  for (const r of results) {
    const row = node("article", "test-result");
    row.append(
      node(
        "span",
        "badge" + (r.passed ? "" : " fail"),
        r.passed ? "PASS" : "FAIL",
      ),
    );
    const body = node("div");
    body.append(
      node("h3", "", r.name || r.label || "Scenario step"),
      node("p", "", r.detail || r.message || (r.errors || []).join("; ")),
    );
    row.append(body);
    $("test-results").append(row);
  }
}
for (const b of document.querySelectorAll("[data-view]"))
  b.onclick = () => view(b.dataset.view);
for (const b of document.querySelectorAll("[data-inspect]"))
  b.onclick = () => inspectTab(b.dataset.inspect);
$("command-search").oninput = renderCommands;
$("first-ticket").onclick = () =>
  requestCommand(
    contract.recipe === "tickets"
      ? "ticket"
      : contract.recipe === "signups"
        ? "event-create"
        : commands[0]?.name,
  );
$("send-command").onclick = () =>
  requestCommand($("command-input").value.trim().replace(/^\//, ""));
$("command-input").onkeydown = (e) => {
  if (e.key === "Enter") $("send-command").click();
};
$("args-form").onsubmit = (e) => {
  e.preventDefault();
  if (!pendingCommand) return;
  const { command, actor } = pendingCommand,
    data = new FormData(e.target),
    args = {};
  for (const o of command.options) {
    const raw = data.get(o.name);
    if (raw === null || raw === "") continue;
    args[o.name] = o.choices
      ? o.choices[Number(raw)].value
      : o.type === "boolean"
        ? raw === "0"
        : ["number", "integer"].includes(o.type)
          ? Number(raw)
          : String(raw);
  }
  $("args-dialog").close();
  pendingCommand = null;
  run(command.name, "command", { ...actor, args });
};
$("cancel-args").onclick = () => {
  $("args-dialog").close();
  pendingCommand = null;
};
$("modal-form").onsubmit = (e) => {
  e.preventDefault();
  if (!pendingModal) return;
  const { data, actor } = pendingModal;
  $("modal-dialog").close();
  pendingModal = null;
  run(data.id, "modal", {
    ...actor,
    fields: Object.fromEntries(new FormData(e.target)),
  });
};
$("cancel-modal").onclick = () => {
  $("modal-dialog").close();
  pendingModal = null;
};
$("run-tests").onclick = async () => {
  const button = $("run-tests");
  button.disabled = true;
  button.textContent = "Running…";
  try {
    renderTests(await api("test", {}));
    $("custom-trace").classList.add("hidden");
  } catch (e) {
    status(e.message);
  } finally {
    button.disabled = false;
    button.textContent = "Run recipe suite";
  }
};
$("capture-scenario").onclick = () => {
  $("scenario-json").value = JSON.stringify(capturedScenario(), null, 2);
  view("scenarios");
  $("scenario-error").textContent =
    "Captured inputs and inferred assertions. Dynamic IDs or text may need edits. This test starts with fresh state.";
};
$("run-custom").onclick = async () => {
  const button = $("run-custom");
  button.disabled = true;
  $("scenario-error").textContent = "";
  try {
    const scenario = JSON.parse($("scenario-json").value);
    const result = await api("scenario", { scenario });
    renderTests(
      [
        ...(result.steps || result.results || [result]),
        ...(result.batches || []).map((b) => ({
          ...b,
          name: b.label || "Parallel batch assertions",
        })),
      ],
      result.passed,
    );
    $("custom-output").textContent = JSON.stringify(result, null, 2);
    $("custom-trace").classList.remove("hidden");
  } catch (e) {
    $("scenario-error").textContent = e.message;
  } finally {
    button.disabled = false;
  }
};
$("import-scenario").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 32768) throw Error("Scenario must be under 32 KB.");
    const parsed = JSON.parse(await file.text());
    $("scenario-json").value = JSON.stringify(parsed, null, 2);
    $("scenario-error").textContent =
      "Imported. Review the assertions, then run it.";
  } catch (e) {
    $("scenario-error").textContent = e.message;
  }
};
$("save-scenario").onclick = () => {
  try {
    download("guildwright-scenario.json", JSON.parse($("scenario-json").value));
  } catch (e) {
    $("scenario-error").textContent = e.message;
  }
};
$("import-evidence").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5000000)
      throw Error("Evidence file exceeds 5 MB. Export a shorter session.");
    const evidence = JSON.parse(await file.text());
    if (evidence.executions)
      evidence.executions = evidence.executions.map((e) => ({
        input: e.input,
        simulation: e.simulation,
      }));
    const payload = JSON.stringify({ evidence });
    if (new TextEncoder().encode(payload).length > 512000)
      throw Error("Replay input exceeds 512 KB. Use a shorter session.");
    $("replay-status").textContent = "Replaying in an isolated simulator…";
    const result = await api("replay", { evidence });
    $("replay-output").textContent = JSON.stringify(result, null, 2);
    $("replay-details").hidden = false;
    const failures = result.results?.filter((r) => r.diagnostics.length) || [];
    $("replay-status").textContent = result.steps
      ? `${result.passed ? "Passed" : "Failed"} replayed scenario.`
      : `Replayed ${result.results?.length || 0} interactions · ${failures.length} with diagnostics. Inspect results; replay does not infer assertions.`;
  } catch (e) {
    $("replay-status").textContent = e.message;
  }
};
$("export").onclick = async () => {
  try {
    const value = await api("evidence");
    download("guildwright-evidence.json", value);
  } catch (e) {
    status(
      "Session export failed: " +
        e.message +
        ". Retry when the local server is available.",
    );
  }
};
$("export-contract").onclick = () =>
  download("guildwright-contract.json", {
    bot: botName,
    commands,
    routes: contract.routes,
    stateSchemas: contract.stateSchemas,
  });
$("reset").onclick = async () => {
  if (!confirm("Clear this simulator’s state and interaction history?")) return;
  try {
    const r = await api("reset", {});
    history = [];
    selectedExecution = -1;
    renderState(r.state, true);
    $("messages").replaceChildren(
      node("p", "muted", "Session reset. Choose a command to begin."),
    );
    $("diagnostics").replaceChildren(
      node("p", "muted", "No execution selected."),
    );
    $("lifecycle").replaceChildren();
    $("state-diff").replaceChildren();
    $("raw-output").textContent = "{}";
    $("run-count").textContent = "0";
    renderHistory();
  } catch (e) {
    status(e.message);
  }
};
api("session")
  .then((data) => {
    contract = data;
    session = data.session;
    botName = data.bot;
    commands = data.commands;
    history = data.history.map((r, i) => ({
      ...r,
      uiBefore: i ? data.history[i - 1].state : data.initialState,
    }));
    $("bot-name").textContent = data.bot;
    $("workspace-description").textContent =
      `${commands.length} shared commands · ${data.recipe === "custom" ? "Custom bot" : data.recipe + " recipe"} · Local development workspace`;
    renderState(data.state, true);
    renderCommands();
    renderContract();
    $("ticket-state").classList.toggle(
      "hidden",
      data.recipe === "signups" || data.recipe === "polls",
    );
    $("event-state").classList.toggle(
      "hidden",
      data.recipe === "tickets" || data.recipe === "polls",
    );
    $("recipe-guide").replaceChildren(
      node(
        "p",
        "",
        data.recipe === "signups"
          ? "Create an event as Alex, then join as Mira and Rowan. Test the last available place."
          : data.recipe === "tickets"
            ? "Open a ticket as Mira. Try its close button as Rowan, then as Alex."
            : "Invoke a command, inspect its state changes, then capture the behavior as a scenario.",
      ),
    );
    const firstStep =
      data.recipe === "polls"
        ? {
            name: "poll create",
            actor: "member",
            args: {
              question: "Next workshop?",
              answers: "Debugging | Testing",
            },
            expect: { clean: true },
          }
        : data.recipe === "signups"
          ? {
              name: "event-create",
              actor: "moderator",
              args: { title: "Local meetup", capacity: 2 },
              expect: { clean: true },
            }
          : {
              name: commands[0]?.name || "hello",
              actor: "member",
              expect: { clean: true },
            };
    $("scenario-json").value = JSON.stringify(
      {
        name: data.bot + " / first command",
        steps: [firstStep],
      },
      null,
      2,
    );
    if (history.length) {
      $("messages").replaceChildren();
      for (const r of history) renderEvents(r, false);
      inspectExecution(history.length - 1);
    }
    renderHistory();
    view(location.hash.slice(1) || "workshop");
  })
  .catch((e) => status(`Cannot reach the workspace: ${e.message}`));

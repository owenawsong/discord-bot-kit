import { writeFile } from "node:fs/promises";
import { Simulator, input, actors } from "../dist/src/simulate.js";
import { ticketBot } from "../dist/src/recipes.js";

const sim = new Simulator(ticketBot());
const opened = await sim.run(
  input("ticket:create", {
    kind: "modal",
    fields: { topic: "Help with an event signup" },
  }),
);
const ticket = opened.state.tickets[0];
if (opened.diagnostics.length || !ticket || ticket.status !== "open")
  throw Error("Ticket creation failed");
const denied = await sim.run(
  input(`ticket:close:${ticket.id}`, {
    kind: "button",
    actor: actors.stranger,
  }),
);
if (
  denied.diagnostics[0]?.code !== "GW_PERMISSION_DENIED" ||
  denied.state.tickets[0].status !== "open"
)
  throw Error("Forbidden closure did not preserve state");
const closed = await sim.run(
  input(`ticket:close:${ticket.id}`, {
    kind: "button",
    actor: actors.moderator,
  }),
);
if (closed.diagnostics.length || closed.state.tickets[0].status !== "closed")
  throw Error("Moderator closure failed");

const rows = [opened, denied, closed].map((r) => ({
  actor: r.input.actor.name,
  interaction: r.input.name,
  kind: r.input.kind,
  outcome: r.diagnostics[0]?.code || "Acknowledged",
  ticketState: r.state.tickets[0].status,
  events: r.events.map((e) => e.type),
}));
await writeFile(
  new URL("../assets/ticket-walkthrough.json", import.meta.url),
  JSON.stringify({ environment: "local-simulation", rows }, null, 2) + "\n",
);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const labels = [
  "Open a support ticket",
  "Try closing someone else’s ticket",
  "Close as the moderator",
];
const tones = ["#9fd6bf", "#f4b2a4", "#b9a9ff"];
const cards = rows
  .map((r, i) => {
    const x = 28 + i * 318;
    return `<g transform="translate(${x},90)"><rect width="300" height="185" rx="9" fill="#20232e" stroke="#383d4e"/><text x="18" y="30" fill="${tones[i]}" font-size="13" font-weight="700">${i + 1} / ${esc(r.actor)}</text><text x="18" y="61" fill="#f1f2f8" font-size="14">${esc(labels[i])}</text><text x="18" y="91" fill="#aeb7cb" font-family="monospace" font-size="11">${esc(r.interaction)}</text><path d="M18 111H282" stroke="#383d4e"/><text x="18" y="137" fill="${tones[i]}" font-family="monospace" font-size="11">${esc(r.outcome)}</text><text x="18" y="164" fill="#f1f2f8" font-size="12">ticket state: ${esc(r.ticketState)}</text></g>`;
  })
  .join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="326" viewBox="0 0 1000 326" role="img" aria-labelledby="title desc"><title id="title">Local ticket workflow from actual Discord Bot Kit handlers</title><desc id="desc">Mira creates a ticket. Rowan is denied closure and its state remains open. Alex closes it as moderator. This is a trace illustration, not a Discord screenshot.</desc><rect width="1000" height="326" rx="12" fill="#161922"/><g font-family="Arial,Helvetica,sans-serif"><text x="28" y="36" fill="#f1f2f8" font-size="19" font-weight="700">A button click is a new authorization check.</text><text x="28" y="62" fill="#aeb7cb" font-size="12">Local ticket workflow · generated from shared handlers</text>${cards}<text x="28" y="306" fill="#aeb7cb" font-size="11">Assert the response and resulting state. Preserve the workflow as an executable scenario.</text></g></svg>`;
await writeFile(
  new URL("../assets/ticket-walkthrough.svg", import.meta.url),
  svg + "\n",
);
console.log(
  "Generated verified local interaction trace and README illustration.",
);

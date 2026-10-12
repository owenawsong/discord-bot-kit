import type { Embed, Message } from "./types.js";
export class MessageFault extends Error {
  readonly code = "GW_OUTPUT_INVALID";
  readonly remedy =
    "Check Discord content/embed/component limits before sending. Embeds allow at most 6000 total text characters across the message.";
}
function fail(message: string): never {
  throw new MessageFault(message);
}
function text(value: unknown, max: number, required = false) {
  if (value === undefined && !required) return;
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && value.length < 1)
  )
    fail("An embed text field exceeds its supported bounds.");
}
function url(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string") fail("Embed URLs must be HTTP(S) URLs.");
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      fail("Embed URLs must use HTTP(S) without credentials.");
  } catch {
    fail("Embed URLs must be valid HTTP(S) URLs.");
  }
}
function embed(value: Embed): number {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Invalid embed object.");
  text(value.title, 256);
  text(value.description, 4096);
  url(value.url);
  if (
    value.color !== undefined &&
    (!Number.isInteger(value.color) ||
      value.color < 0 ||
      value.color > 0xffffff)
  )
    fail("Embed color must be an integer from 0 to 0xffffff.");
  let total = (value.title?.length ?? 0) + (value.description?.length ?? 0);
  if (value.fields !== undefined) {
    if (!Array.isArray(value.fields) || value.fields.length > 25)
      fail("An embed supports at most 25 fields.");
    for (const field of value.fields) {
      if (!field) fail("Invalid embed field.");
      text(field.name, 256, true);
      text(field.value, 1024, true);
      if (field.inline !== undefined && typeof field.inline !== "boolean")
        fail("Embed field inline must be boolean.");
      total += field.name.length + field.value.length;
    }
  }
  if (value.footer) {
    text(value.footer.text, 2048, true);
    total += value.footer.text.length;
  }
  if (value.author) {
    text(value.author.name, 256, true);
    url(value.author.url);
    url(value.author.iconURL);
    total += value.author.name.length;
  }
  if (value.thumbnail) {
    url(value.thumbnail.url);
    if (!value.thumbnail.url) fail("Embed thumbnail requires a URL.");
  }
  if (value.image) {
    url(value.image.url);
    if (!value.image.url) fail("Embed image requires a URL.");
  }
  if (
    value.timestamp !== undefined &&
    (typeof value.timestamp !== "string" ||
      !Number.isFinite(Date.parse(value.timestamp)))
  )
    fail("Embed timestamp must be a valid date string.");
  return total;
}
export function validateMessage(m: Message) {
  if (!m || typeof m !== "object") fail("Invalid message.");
  if (
    m.content !== undefined &&
    (typeof m.content !== "string" || m.content.length > 2000)
  )
    fail("Message content must be at most 2000 characters.");
  if (m.ephemeral !== undefined && typeof m.ephemeral !== "boolean")
    fail("Message ephemeral must be boolean.");
  if (
    m.embeds !== undefined &&
    (!Array.isArray(m.embeds) || m.embeds.length > 10)
  )
    fail("Messages support at most ten embeds.");
  if ((m.embeds ?? []).reduce((sum, e) => sum + embed(e), 0) > 6000)
    fail("Embed text exceeds 6000 aggregate characters.");
  if (
    m.buttons &&
    (!Array.isArray(m.buttons) ||
      m.buttons.length > 5 ||
      m.buttons.some(
        (b) =>
          !b ||
          typeof b.id !== "string" ||
          b.id.length < 1 ||
          b.id.length > 100 ||
          typeof b.label !== "string" ||
          b.label.length < 1 ||
          b.label.length > 80 ||
          (b.style !== undefined &&
            !["primary", "secondary", "danger"].includes(b.style)),
      ))
  )
    fail("Invalid buttons: at most five, with valid IDs, labels and styles.");
  if (
    m.select &&
    (typeof m.select.id !== "string" ||
      m.select.id.length < 1 ||
      m.select.id.length > 100 ||
      typeof m.select.placeholder !== "string" ||
      m.select.placeholder.length > 150 ||
      !Array.isArray(m.select.options) ||
      m.select.options.length < 1 ||
      m.select.options.length > 25 ||
      m.select.options.some(
        (o) =>
          !o ||
          typeof o.label !== "string" ||
          o.label.length < 1 ||
          o.label.length > 100 ||
          typeof o.value !== "string" ||
          o.value.length < 1 ||
          o.value.length > 100,
      ) ||
      new Set(m.select.options.map((o) => o.value)).size !==
        m.select.options.length)
  )
    fail("Invalid select menu.");
  if (
    !m.content?.length &&
    !m.embeds?.length &&
    !m.buttons?.length &&
    !m.select
  )
    fail("A message needs content, embeds or components.");
}

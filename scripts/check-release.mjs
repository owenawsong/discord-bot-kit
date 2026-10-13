import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";
import assert from "node:assert/strict";
import { VERSION } from "../dist/src/identity.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(pkg.name, "@owenawsong/discord-bot-kit");
assert.equal(pkg.version, VERSION);
assert.ok(pkg.bin["discord-bot-kit"]);
const docs = [
  resolve(root, "README.md"),
  ...(await readdir(resolve(root, "docs")))
    .filter((n) => n.endsWith(".md"))
    .map((n) => resolve(root, "docs", n)),
];
for (const path of docs) {
  const text = await readFile(path, "utf8");
  for (const match of text.matchAll(
    /(?:\]\(|src=")([^\s)"#]+)(?:#[^\s)"]*)?[)"]/g,
  )) {
    const link = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
    const target = resolve(dirname(path), link);
    assert.ok(
      !relative(root, target).startsWith(".."),
      "Documentation link escapes repository",
    );
    const entry = await stat(target).catch(() => {
      throw Error(`${relative(root, path)}: missing ${link}`);
    });
    if (entry.isFile()) assert.ok(entry.size > 0, `Empty linked file: ${link}`);
  }
}
const demo = JSON.parse(
  await readFile(resolve(root, "assets/ticket-walkthrough.json"), "utf8"),
);
assert.equal(demo.environment, "local-simulation");
assert.deepEqual(
  demo.rows.map((r) => r.ticketState),
  ["open", "open", "closed"],
);
assert.equal(demo.rows[1].outcome, "GW_PERMISSION_DENIED");
console.log(
  "Release metadata, linked documents/assets and generated interaction evidence verified.",
);

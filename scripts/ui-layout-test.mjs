import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8")
]);

assert.match(html, /class="proof-step proof-dealer"/);
assert.match(html, /class="proof-step proof-memory"/);
assert.match(html, /class="proof-step proof-pos"/);
assert.doesNotMatch(html, /class="proof-step memory"/);
assert.match(css, /\.evidence-node\.memory\s*\{\s*grid-area:\s*memory;/);
assert.match(css, /\.proof-memory\s*\{\s*grid-area:\s*memory;/);
assert.match(css, /"dealer arrow-one memory arrow-two pos"/);

console.log("PASS bypass-proof grid uses isolated, explicit layout areas.");

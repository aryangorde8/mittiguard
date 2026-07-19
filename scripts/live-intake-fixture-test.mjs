import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const document = JSON.parse(await readFile(new URL("../fixtures/live-intake-fixtures.json", import.meta.url), "utf8"));
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const [name, dataUrl] of Object.entries(document.imageFixtures || {})) {
  const match = String(dataUrl).match(/^data:image\/png;base64,([a-z0-9+/=]+)$/i);
  assert.ok(match, `${name} must be a PNG data URL.`);
  const raw = Buffer.from(match[1], "base64");
  assert.ok(raw.subarray(0, 8).equals(pngSignature), `${name} must have a PNG signature.`);
  assert.ok(raw.length >= 33, `${name} is too small to contain PNG metadata.`);
  assert.equal(raw.subarray(12, 16).toString(), "IHDR", `${name} must begin with an IHDR chunk.`);
  const width = raw.readUInt32BE(16);
  const height = raw.readUInt32BE(20);
  assert.ok(width >= 32 && height >= 32, `${name} must be at least 32×32.`);

  const idat = [];
  let offset = 8;
  while (offset < raw.length) {
    assert.ok(offset + 12 <= raw.length, `${name} has a truncated PNG chunk.`);
    const length = raw.readUInt32BE(offset);
    const type = raw.subarray(offset + 4, offset + 8).toString();
    const end = offset + 12 + length;
    assert.ok(end <= raw.length, `${name} has an invalid ${type} chunk length.`);
    if (type === "IDAT") idat.push(raw.subarray(offset + 8, offset + 8 + length));
    offset = end;
  }
  assert.ok(idat.length, `${name} must contain image data.`);
  assert.ok(inflateSync(Buffer.concat(idat)).length > 0, `${name} contains unreadable PNG image data.`);
}

console.log("PASS live intake fixture images are valid, decodable PNG attachments before any Bedrock call.");

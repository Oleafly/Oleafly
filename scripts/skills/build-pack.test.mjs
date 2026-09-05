import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packVersion } from "./build-pack.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = resolve(SCRIPT_DIR, "..", "..", "src-tauri", "resources", "skills", "pack.json");

const SKILLS = [
  { id: "alpha", treeSha256: "a".repeat(64) },
  { id: "beta", treeSha256: "b".repeat(64) },
];

test("the pack version carries the date and a content digest", () => {
  const version = packVersion(SKILLS);
  assert.match(version, /^\d{4}\.\d{2}\.\d{2}\.[0-9a-f]{8}$/);
  assert.equal(packVersion(SKILLS), version);
});

test("a changed skill tree changes the pack version", () => {
  const before = packVersion(SKILLS);
  const after = packVersion([SKILLS[0], { id: "beta", treeSha256: "c".repeat(64) }]);
  assert.notEqual(before, after);
});

test("a renamed skill changes the pack version", () => {
  const renamed = packVersion([{ id: "gamma", treeSha256: SKILLS[0].treeSha256 }, SKILLS[1]]);
  assert.notEqual(packVersion(SKILLS), renamed);
});

test("the committed pack.json version matches its own skill hashes", async () => {
  const pack = JSON.parse(await readFile(PACK_PATH, "utf8"));
  assert.equal(pack.version, packVersion(pack.skills));
});

test("the bundled floor catalog agrees with pack.json", async () => {
  const pack = JSON.parse(await readFile(PACK_PATH, "utf8"));
  const catalogPath = join(dirname(dirname(PACK_PATH)), "skills-catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  assert.equal(catalog.packs[0].version, pack.version);
  assert.equal(catalog.skills.length, pack.skills.length);
});

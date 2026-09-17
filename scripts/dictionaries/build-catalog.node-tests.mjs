import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BUNDLED_LOCALE_IDS,
  DICTIONARY_CODES,
  buildPack,
  displayNamesFor,
  jsdelivrUrl,
  licenseIdFrom,
  localeIdFor,
  npmNameFor,
  sha256Hex,
  sortPacks,
  validateCatalog,
} from "./build-catalog.mjs";

function samplePack(overrides = {}) {
  return {
    id: "es_ES",
    language: "Spanish",
    region: "Spain",
    npmName: "dictionary-es",
    version: "4.0.0",
    bundled: false,
    files: [
      {
        name: "es_ES.aff",
        url: "https://cdn.jsdelivr.net/npm/dictionary-es@4.0.0/index.aff",
        sha256: "a".repeat(64),
        bytes: 10,
      },
      {
        name: "es_ES.dic",
        url: "https://cdn.jsdelivr.net/npm/dictionary-es@4.0.0/index.dic",
        sha256: "b".repeat(64),
        bytes: 20,
      },
    ],
    license: { id: "MIT", url: "https://example.invalid/license" },
    ...overrides,
  };
}

test("a bare language code gains the region its locale implies", () => {
  assert.equal(localeIdFor("es"), "es_ES");
  assert.equal(localeIdFor("de"), "de_DE");
  assert.equal(localeIdFor("fr"), "fr_FR");
  assert.equal(localeIdFor("nb"), "nb_NO");
  assert.equal(localeIdFor("pt"), "pt_BR");
  assert.equal(localeIdFor("en"), "en_US");
});

test("an explicit region or script is kept instead of being maximized", () => {
  assert.equal(localeIdFor("en-gb"), "en_GB");
  assert.equal(localeIdFor("pt-pt"), "pt_PT");
  assert.equal(localeIdFor("de-ch"), "de_CH");
  assert.equal(localeIdFor("sr-latn"), "sr_Latn");
  assert.equal(localeIdFor("sr"), "sr_RS");
});

test("languages without a country keep a bare identifier", () => {
  assert.equal(localeIdFor("eo"), "eo");
  assert.equal(localeIdFor("la"), "la");
});

test("every configured code produces a unique identifier", () => {
  const ids = DICTIONARY_CODES.map(localeIdFor);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/u);
  }
});

test("display names separate the language from its region or script", () => {
  assert.deepEqual(displayNamesFor("es_ES"), {
    language: "Spanish",
    region: "Spain",
  });
  assert.deepEqual(displayNamesFor("eo"), {
    language: "Esperanto",
    region: null,
  });
  assert.deepEqual(displayNamesFor("sr_Latn"), {
    language: "Serbian",
    region: "Latin",
  });
});

test("download addresses pin the exact published version", () => {
  assert.equal(npmNameFor("es"), "dictionary-es");
  assert.equal(
    jsdelivrUrl("dictionary-es", "4.0.0", "index.dic"),
    "https://cdn.jsdelivr.net/npm/dictionary-es@4.0.0/index.dic",
  );
});

test("checksums are lowercase hexadecimal SHA-256", () => {
  assert.equal(
    sha256Hex(Buffer.from("oleafly")),
    sha256Hex(new Uint8Array(Buffer.from("oleafly"))),
  );
  assert.match(sha256Hex(Buffer.from("")), /^[0-9a-f]{64}$/u);
});

test("a license identifier is read from either npm spelling", () => {
  assert.equal(licenseIdFrom({ license: "MIT" }), "MIT");
  assert.equal(licenseIdFrom({ license: { type: "GPL-2.0" } }), "GPL-2.0");
  assert.equal(licenseIdFrom({}), "");
  assert.equal(licenseIdFrom(null), "");
});

test("a pack carries both files, its license and its bundled state", () => {
  const pack = buildPack({
    code: "es",
    version: "4.0.0",
    licenseId: "MIT",
    downloads: {
      aff: { sha256: "a".repeat(64), bytes: 10 },
      dic: { sha256: "b".repeat(64), bytes: 20 },
    },
  });
  assert.equal(pack.id, "es_ES");
  assert.equal(pack.bundled, false);
  assert.deepEqual(
    pack.files.map((file) => file.name),
    ["es_ES.aff", "es_ES.dic"],
  );
  assert.equal(
    pack.license.url,
    "https://cdn.jsdelivr.net/npm/dictionary-es@4.0.0/license",
  );

  const shipped = buildPack({
    code: "fr",
    version: "2.7.0",
    licenseId: "LGPL-2.1",
    downloads: {
      aff: { sha256: "c".repeat(64), bytes: 10 },
      dic: { sha256: "d".repeat(64), bytes: 20 },
    },
  });
  assert.equal(shipped.bundled, true);
});

test("packs are written in a stable order", () => {
  const packs = [
    samplePack({ id: "fr_FR" }),
    samplePack({ id: "de_DE" }),
    samplePack({ id: "es_ES" }),
  ];
  assert.deepEqual(
    sortPacks(packs).map((pack) => pack.id),
    ["de_DE", "es_ES", "fr_FR"],
  );
  assert.deepEqual(
    sortPacks(packs),
    sortPacks(sortPacks(packs)),
  );
});

test("validation rejects catalogs that cannot be trusted", () => {
  const good = BUNDLED_LOCALE_IDS.map((id) => samplePack({ id }));
  assert.deepEqual(validateCatalog(good), []);

  assert.ok(
    validateCatalog([...good, samplePack({ id: "en_US" })]).some((problem) =>
      problem.includes("duplicate"),
    ),
  );
  assert.ok(
    validateCatalog(good.slice(1)).some((problem) =>
      problem.includes("missing"),
    ),
  );
  const badChecksum = BUNDLED_LOCALE_IDS.map((id) =>
    samplePack({
      id,
      files: samplePack().files.map((file) => ({ ...file, sha256: "nope" })),
    }),
  );
  assert.ok(
    validateCatalog(badChecksum).some((problem) =>
      problem.includes("checksum"),
    ),
  );
  const insecure = BUNDLED_LOCALE_IDS.map((id) =>
    samplePack({
      id,
      files: samplePack().files.map((file) => ({
        ...file,
        url: file.url.replace("https://", "http://"),
      })),
    }),
  );
  assert.ok(
    validateCatalog(insecure).some((problem) => problem.includes("HTTPS")),
  );
});

test("the committed catalog is well formed", async () => {
  const packs = JSON.parse(
    await readFile(
      new URL("../../src-tauri/resources/dictionary-packs.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(validateCatalog(packs), []);
  assert.deepEqual(packs, sortPacks(packs));
  assert.ok(packs.length >= 60);
  const ids = new Set(packs.map((pack) => pack.id));
  for (const id of BUNDLED_LOCALE_IDS) {
    assert.ok(ids.has(id), `${id} is in the catalog`);
  }
  for (const pack of packs) {
    assert.equal(
      pack.bundled,
      BUNDLED_LOCALE_IDS.includes(pack.id),
      `${pack.id} bundled flag`,
    );
    assert.equal(pack.npmName, npmNameFor(pack.npmName.slice("dictionary-".length)));
    for (const file of pack.files) {
      assert.ok(
        file.url.startsWith(`https://cdn.jsdelivr.net/npm/${pack.npmName}@${pack.version}/`),
        `${pack.id} address is pinned`,
      );
    }
  }
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_DICTIONARY_LOCALES } from "@/lib/proofreading/dictionary-catalog";

const dictionaryDirectory = resolve(process.cwd(), "public/dictionaries");
const catalogPath = resolve(
  process.cwd(),
  "src-tauri/resources/dictionary-packs.json",
);

interface CatalogFile {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
}

interface CatalogPack {
  id: string;
  language: string;
  region: string | null;
  npmName: string;
  version: string;
  bundled: boolean;
  files: CatalogFile[];
  license: { id: string; url: string };
}

function catalog(): CatalogPack[] {
  return JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogPack[];
}

function shippedPacks(): string[] {
  const files = readdirSync(dictionaryDirectory);
  const aff = new Set(
    files.filter((file) => file.endsWith(".aff")).map((file) => file.slice(0, -4)),
  );
  const dic = new Set(
    files.filter((file) => file.endsWith(".dic")).map((file) => file.slice(0, -4)),
  );
  expect([...aff].sort()).toEqual([...dic].sort());
  return [...aff].sort();
}

function dictionaryRoots(locale: string): Set<string> {
  const lines = readFileSync(
    resolve(dictionaryDirectory, `${locale}.dic`),
    "utf8",
  ).split(/\r?\n/u);
  const declaredCount = Number(lines.shift());
  const entries = lines.filter(Boolean);
  expect(entries.length).toBeGreaterThan(1_000);
  expect(Math.abs(entries.length - declaredCount)).toBeLessThan(100);
  return new Set(
    entries.map((entry) => entry.split("/", 1)[0].normalize("NFC")),
  );
}

describe("shipped spelling dictionaries", () => {
  it("ships a non-empty paired pack for every bundled locale", () => {
    const packs = shippedPacks();
    expect(packs).toEqual([...BUNDLED_DICTIONARY_LOCALES].sort());
    expect(packs).toContain("en_US");
    for (const locale of packs) {
      expect(
        statSync(resolve(dictionaryDirectory, `${locale}.aff`)).size,
      ).toBeGreaterThan(0);
      expect(
        statSync(resolve(dictionaryDirectory, `${locale}.dic`)).size,
      ).toBeGreaterThan(0);
    }
  });

  it("loads locale-specific lexical behavior instead of mislabeled fallback packs", () => {
    const american = dictionaryRoots("en_US");
    const british = dictionaryRoots("en_GB");
    const australian = dictionaryRoots("en_AU");
    const german = dictionaryRoots("de_DE");
    const french = dictionaryRoots("fr_FR");

    expect(american.has("color")).toBe(true);
    expect(american.has("center")).toBe(true);
    expect(american.has("organization")).toBe(true);
    expect(american.has("colour")).toBe(false);
    expect(british.has("colour")).toBe(true);
    expect(british.has("centre")).toBe(true);
    expect(british.has("organisation")).toBe(true);
    expect(australian.has("colour")).toBe(true);
    expect(australian.has("centre")).toBe(true);
    expect(german.has("hallo")).toBe(true);
    expect(german.has("Farbe")).toBe(true);
    expect(french.has("bonjour")).toBe(true);
    expect(french.has("couleur")).toBe(true);
    for (const roots of [american, british, australian, german, french]) {
      expect(roots.has("colur")).toBe(false);
    }
  });
});

describe("downloadable dictionary catalog", () => {
  it("offers a language set far wider than the bundled packs", () => {
    const packs = catalog();
    expect(packs.length).toBeGreaterThanOrEqual(60);
    const ids = packs.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    for (const locale of BUNDLED_DICTIONARY_LOCALES) {
      expect(ids).toContain(locale);
    }
  });

  it("marks exactly the packs that ship inside the app as bundled", () => {
    const bundled = catalog()
      .filter((pack) => pack.bundled)
      .map((pack) => pack.id)
      .sort();
    expect(bundled).toEqual(shippedPacks());
  });

  it("publishes a verifiable pinned download for every entry", () => {
    for (const pack of catalog()) {
      expect(pack.id).toMatch(/^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/u);
      expect(pack.language.length).toBeGreaterThan(0);
      expect(pack.license.id.length).toBeGreaterThan(0);
      expect(pack.files).toHaveLength(2);
      expect(pack.files.map((file) => file.name)).toEqual([
        `${pack.id}.aff`,
        `${pack.id}.dic`,
      ]);
      for (const file of pack.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.url).toBe(
          `https://cdn.jsdelivr.net/npm/${pack.npmName}@${pack.version}/index.${file.name.slice(-3)}`,
        );
      }
    }
  });
});

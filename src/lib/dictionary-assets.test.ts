import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DICTIONARY_LOCALES,
  type DictionaryLocale,
} from "@/store/settings";

const dictionaryDirectory = resolve(
  process.cwd(),
  "public/dictionaries",
);

function shippedPacks(): string[] {
  const files = readdirSync(dictionaryDirectory);
  const aff = new Set(
    files
      .filter((file) => file.endsWith(".aff"))
      .map((file) => file.slice(0, -4)),
  );
  const dic = new Set(
    files
      .filter((file) => file.endsWith(".dic"))
      .map((file) => file.slice(0, -4)),
  );
  expect([...aff].sort()).toEqual([...dic].sort());
  return [...aff].sort();
}

function dictionaryRoots(locale: DictionaryLocale): Set<string> {
  const lines = readFileSync(
    resolve(dictionaryDirectory, `${locale}.dic`),
    "utf8",
  ).split(/\r?\n/u);
  const declaredCount = Number(lines.shift());
  const entries = lines.filter(Boolean);
  // Some upstream packs have small historical header-count drift after
  // compatibility aliases were added or removed. Reject empty/truncated packs
  // while accepting that upstream convention.
  expect(entries.length).toBeGreaterThan(1_000);
  expect(Math.abs(entries.length - declaredCount)).toBeLessThan(100);
  return new Set(
    entries.map((entry) => entry.split("/", 1)[0].normalize("NFC")),
  );
}

describe("shipped spelling dictionaries", () => {
  it("ships a non-empty paired pack for every selectable locale", () => {
    const packs = shippedPacks();
    const selectable = DICTIONARY_LOCALES.map(
      ({ id }) => id satisfies DictionaryLocale,
    ).sort();
    expect(packs).toEqual(selectable);
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
    for (const roots of [
      american,
      british,
      australian,
      german,
      french,
    ]) {
      expect(roots.has("colur")).toBe(false);
    }
  });
});

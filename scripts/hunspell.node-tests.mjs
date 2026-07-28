import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const DICTIONARIES = [
  ["en_US", "color", "colur", "color"],
  ["en_GB", "colour", "colur", "colour"],
  ["en_AU", "colour", "colur", "colour"],
  ["de_DE", "Farbe", "Farbee", "Farbe"],
  ["fr_FR", "couleur", "couleurr", "couleur"],
];

test("the patched ESM Node runtime has a callable default export", async () => {
  const runtime = await import(
    "hunspell-asm/dist/esm/lib/node/hunspell.js"
  );
  assert.equal(typeof runtime.default, "function");
});

test("the native Node package path loads every shipped dictionary", async () => {
  // Native Node resolves the package's CommonJS `main`. This deliberately
  // differs from Vite's browser/module resolution and protects both paths.
  const { loadModule } = await import("hunspell-asm");
  const factory = await loadModule();

  for (const [locale, knownWord, typo, expectedSuggestion] of DICTIONARIES) {
    const [aff, dictionary] = await Promise.all([
      readFile(
        new URL(
          `../public/dictionaries/${locale}.aff`,
          import.meta.url,
        ),
      ),
      readFile(
        new URL(
          `../public/dictionaries/${locale}.dic`,
          import.meta.url,
        ),
      ),
    ]);
    // Omit filenames to exercise the transitive loader's secured NanoID v3
    // compatibility path as well as Hunspell's own generated mount root.
    const affPath = factory.mountBuffer(aff);
    const dictionaryPath = factory.mountBuffer(dictionary);
    const checker = factory.create(affPath, dictionaryPath);
    const userWord = "Oleaflyruntimeword";
    try {
      assert.equal(checker.spell(knownWord), true, `${locale} known word`);
      assert.equal(checker.spell(typo), false, `${locale} typo`);
      assert.ok(
        checker.suggest(typo).includes(expectedSuggestion),
        `${locale} suggestions`,
      );
      assert.equal(checker.spell(userWord), false, `${locale} user word`);
      checker.addWord(userWord);
      assert.equal(
        checker.spell(userWord),
        true,
        `${locale} added user word`,
      );
    } finally {
      checker.dispose();
    }

    const freshChecker = factory.create(affPath, dictionaryPath);
    try {
      assert.equal(
        freshChecker.spell(userWord),
        false,
        `${locale} user-word isolation`,
      );
    } finally {
      freshChecker.dispose();
      factory.unmount(affPath);
      factory.unmount(dictionaryPath);
    }
  }
});

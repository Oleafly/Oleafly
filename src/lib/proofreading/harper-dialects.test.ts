import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Dialect, LocalLinter } from "harper.js";
import { binary } from "harper.js/binary";
import type { ProofreadingDialect } from "@oleafly/editor";
import { harperDialectFor } from "./dialects";

const dialects = [
  ["american", Dialect.American],
  ["british", Dialect.British],
  ["australian", Dialect.Australian],
  ["canadian", Dialect.Canadian],
  ["indian", Dialect.Indian],
] as const satisfies readonly (readonly [
  ProofreadingDialect,
  Dialect,
])[];

describe("Harper English dialect runtime", () => {
  let linter: LocalLinter;

  beforeAll(async () => {
    linter = new LocalLinter({ binary });
    await linter.setup();
  });

  afterAll(async () => {
    await linter.dispose();
  });

  it("initializes and analyzes prose under all five supported dialects", async () => {
    for (const [index, [preference, dialect]] of dialects.entries()) {
      expect(harperDialectFor(Dialect, preference)).toBe(dialect);
      await expect(
        linter.setDialect(harperDialectFor(Dialect, preference)),
      ).resolves.toBeUndefined();
      const findings = await linter.lint(
        "The colour of this aluminum artifact could of changed.",
        { language: "plaintext" },
      );
      const messages = findings.map((finding) => finding.message());
      expect(
        messages.some((message) => message.includes("rather than `of`")),
      ).toBe(true);
      if (index === 0) {
        expect(messages.some((message) => message.includes("`colour`"))).toBe(
          true,
        );
        expect(
          messages.some((message) => message.includes("`aluminum`")),
        ).toBe(false);
      } else if (index === 3) {
        expect(
          messages.some((message) => /`colour`|`aluminum`/u.test(message)),
        ).toBe(false);
      } else {
        expect(
          messages.some((message) => message.includes("`aluminum`")),
        ).toBe(true);
      }

      const wordChoice = findings.find(
        (finding) => finding.lint_kind() === "WordChoice",
      );
      const suggestions = wordChoice?.suggestions() ?? [];
      expect(
        suggestions.some((suggestion) =>
          suggestion.get_replacement_text().includes("have"),
        ),
      ).toBe(true);
      for (const suggestion of suggestions) suggestion.free();
      for (const finding of findings) finding.free();
    }
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { scriptValue } from "../../e2e/script-value";

describe("packaged conversion checks", () => {
  it("registers every module loaded by the conversion specs", () => {
    const registry = readFileSync(resolve("src/lib/e2e-import-registry.ts"), "utf8");
    const registered = new Set([...registry.matchAll(/"(\/(?:src|packages)\/[^"\n]+)":/g)].map((match) => match[1]));
    for (const name of ["74-conversion-matrix.spec.ts", "75-conversion-matrix-ui.spec.ts"]) {
      const source = readFileSync(resolve("e2e/tests", name), "utf8");
      for (const match of source.matchAll(/import\(\s*"(\/(?:src|packages)\/[^"\n]+)"/g)) {
        expect(registered.has(match[1]), `${name}: ${match[1]}`).toBe(true);
      }
    }
  });
  it("round-trips paths and text without executable HTML delimiters", () => {
    const input = { path: 'C:\\papers\\"draft".tex', text: '</script><script>throw 1</script>\u2028\u2029\n' };
    const encoded = scriptValue(input);
    expect(encoded).not.toMatch(/[<>\u2028\u2029]/);
    expect(runInNewContext(`(${encoded})`)).toEqual(input);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { scriptValue } from "../../e2e/script-value";

/** Specs the packaged app runs, plus the helpers they share. The *-browser specs
 *  run against the Vite dev server, which serves any module without the registry. */
function packagedSources(): string[] {
  const specs = readdirSync(resolve("e2e/tests"))
    .filter((name) => name.endsWith(".spec.ts") && !name.endsWith("-browser.spec.ts"))
    .map((name) => join("e2e/tests", name));
  const helpers = readdirSync(resolve("e2e"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join("e2e", name));
  return [...specs, ...helpers];
}

describe("packaged evaluated imports", () => {
  it("registers every module the packaged specs and their helpers load", () => {
    const registry = readFileSync(resolve("src/lib/e2e-import-registry.ts"), "utf8");
    const registered = new Set([...registry.matchAll(/"(\/(?:src|packages)\/[^"\n]+)":/g)].map((match) => match[1]));
    const sources = packagedSources();
    expect(sources.length).toBeGreaterThan(100);
    for (const name of sources) {
      const source = readFileSync(resolve(name), "utf8");
      expect(source).not.toMatch(/import\(\s*'\/(?:src|packages)\//g);
      expect(source).not.toContain("/node_modules/.vite/");
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

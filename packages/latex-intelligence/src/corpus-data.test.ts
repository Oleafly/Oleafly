import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCore, loadPackageCatalog, setCorpusTransport } from "./index";
import type { CoreCatalog, Manifest, NameList, PackageCatalog } from "./types";
import {
  validateCoreCatalog,
  validateManifest,
  validateNameList,
  validatePackageCatalog,
} from "./validate";

const DATA_DIR = fileURLToPath(
  new URL("../../../public/latex-intelligence/", import.meta.url),
);
const PACKAGES_DIR = `${DATA_DIR}packages/`;

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(`${DATA_DIR}${name}`, "utf8"));
}

// The production loaders fetch the corpus over HTTP from public/. Tests run
// under Node, so back the transport with the filesystem copy instead.
beforeAll(() => {
  setCorpusTransport(async (relativePath) => {
    try {
      return JSON.parse(readFileSync(`${DATA_DIR}${relativePath}`, "utf8")) as unknown;
    } catch {
      return null;
    }
  });
});

afterAll(() => {
  setCorpusTransport(null);
});

/**
 * Assert a snippet carries no raw VS Code snippet-grammar artifacts that
 * scripts/latex-intelligence-extract.mjs should have normalized away:
 * `$0` (VS Code final tabstop; becomes `${}`), `${TM_...}` variables, and
 * undecoded `\}` escapes (which surface as a double backslash before `}`
 * in the parsed string — single `\}` is legitimate LaTeX). Every `${`
 * must also have a closing `}` so the CodeMirror field syntax parses.
 */
function expectCleanSnippet(where: string, snippet: string | undefined): void {
  if (snippet === undefined) return;
  expect(snippet, `${where}: raw VS Code $0 tabstop`).not.toContain("$0");
  expect(snippet, `${where}: raw VS Code \${TM_ variable`).not.toContain("${TM_");
  expect(snippet, `${where}: undecoded \\} escape`).not.toContain("\\\\}");
  let index = 0;
  while (true) {
    index = snippet.indexOf("${", index);
    if (index === -1) break;
    expect(snippet.indexOf("}", index), `${where}: unclosed \${ field in ${JSON.stringify(snippet)}`).not.toBe(-1);
    index += 2;
  }
}

describe("core.json", () => {
  const core = validateCoreCatalog(readJson("core.json"));

  it("passes validateCoreCatalog", () => {
    expect(core).not.toBeNull();
  });

  it("has at least 250 commands and 50 environments", () => {
    const catalog = core as CoreCatalog;
    expect(catalog.commands.length).toBeGreaterThanOrEqual(250);
    expect(catalog.environments.length).toBeGreaterThanOrEqual(50);
  });

  it("contains no raw VS Code snippet artifacts", () => {
    const catalog = core as CoreCatalog;
    for (const command of catalog.commands) {
      expectCleanSnippet(`command ${command.name}`, command.snippet);
    }
    for (const environment of catalog.environments) {
      expectCleanSnippet(`environment ${environment.name}`, environment.snippet);
    }
  });
});

describe.each([
  { file: "package-names.json", minimum: 2500 },
  { file: "class-names.json", minimum: 500 },
])("$file", ({ file, minimum }) => {
  const list = validateNameList(readJson(file));

  it("passes validateNameList", () => {
    expect(list).not.toBeNull();
  });

  it(`has at least ${minimum} names, sorted and unique`, () => {
    const { names } = list as NameList;
    expect(names.length).toBeGreaterThanOrEqual(minimum);
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names).toEqual(sorted);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only carries details for listed names", () => {
    const { names, details } = list as NameList;
    const nameSet = new Set(names);
    for (const key of Object.keys(details)) {
      expect(nameSet.has(key), `details key "${key}" is not a listed name`).toBe(true);
    }
  });
});

describe("packages", () => {
  const fileNames = readdirSync(PACKAGES_DIR).filter((name) => name.endsWith(".json"));

  it("contains exactly 247 catalogs and nothing else", () => {
    expect(readdirSync(PACKAGES_DIR)).toEqual(fileNames);
    expect(fileNames.length).toBe(247);
  });

  it("every catalog passes validatePackageCatalog with well-formed entries", () => {
    for (const fileName of fileNames) {
      const catalog = validatePackageCatalog(
        JSON.parse(readFileSync(`${PACKAGES_DIR}${fileName}`, "utf8")),
      );
      expect(catalog, `packages/${fileName} failed validatePackageCatalog`).not.toBeNull();
      const { macros, envs, keys } = catalog as PackageCatalog;
      for (const macro of macros) {
        expect(macro.name, `packages/${fileName}: empty macro name`).not.toBe("");
        expectCleanSnippet(`packages/${fileName} macro ${macro.name}`, macro.snippet);
      }
      for (const environment of envs) {
        expect(environment.name, `packages/${fileName}: empty environment name`).not.toBe("");
        expectCleanSnippet(`packages/${fileName} env ${environment.name}`, environment.snippet);
      }
      for (const [key, values] of Object.entries(keys)) {
        expect(Array.isArray(values), `packages/${fileName}: keys[${key}] is not an array`).toBe(true);
        for (const value of values) {
          expect(typeof value, `packages/${fileName}: keys[${key}] holds a non-string`).toBe("string");
        }
      }
    }
  });
});

describe("manifest.json", () => {
  const manifest = validateManifest(readJson("manifest.json"));

  it("passes validateManifest", () => {
    expect(manifest).not.toBeNull();
  });

  it("pins the expected upstream commit", () => {
    expect((manifest as Manifest).commit).toBe("becabe238d3539105dd5bb9b7b3571d26e5d43e0");
  });

  it("credits every upstream source in its notices", () => {
    const notices = (manifest as Manifest).notices.join("\n");
    expect(notices).toContain("MIT");
    expect(notices).toContain("TeXStudio");
    expect(notices).toContain("CTAN");
    expect(notices).toContain("LPPL");
  });
});

describe("loaders", () => {
  it("loadPackageCatalog resolves the siunitx catalog with the ang macro", async () => {
    const catalog = await loadPackageCatalog("siunitx");
    expect(catalog).not.toBeNull();
    const angMacros = (catalog as PackageCatalog).macros.filter((macro) => macro.name === "ang");
    expect(angMacros.length).toBeGreaterThan(0);
    expect(angMacros.some((macro) => macro.snippet?.includes("${1"))).toBe(true);
  });

  it("loadPackageCatalog rejects traversal-shaped names without throwing", async () => {
    await expect(loadPackageCatalog("../evil")).resolves.toBeNull();
  });

  it("loadPackageCatalog resolves null for unknown packages without throwing", async () => {
    await expect(loadPackageCatalog("nope-not-real")).resolves.toBeNull();
  });

  it("loadCore caches: repeated calls return the same promise and a catalog", async () => {
    const first = loadCore();
    const second = loadCore();
    expect(first).toBe(second);
    const catalog = await first;
    expect(catalog).not.toBeNull();
    expect((catalog as CoreCatalog).commands.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  validateAtSuggestions,
  validateCoreCatalog,
  validateManifest,
  validateNameList,
  validatePackageCatalog,
} from "./validate";

const PACKAGE = {
  deps: ["xcolor"],
  macros: [
    {
      name: "draw",
      snippet: "\\draw ${1};",
      detail: "path",
      documentation: "Draws a path",
      unusual: false,
      keys: ["\\draw"],
      keyPos: 0,
    },
  ],
  envs: [{ name: "tikzpicture", snippet: "", detail: "env", unusual: true, keys: ["opts"], keyPos: 1 }],
  keys: { "\\draw": ["color=", "thick"] },
  args: ["\\draw"],
  options: ["draft"],
};

const MANIFEST = {
  source: "TeX Live",
  texlive: "2026",
  license: "LPPL",
  generatedBy: "latex-corpus-build",
  catalogs: 3,
  notices: ["one"],
};

describe("validateCoreCatalog", () => {
  it("accepts commands and environments with optional string fields", () => {
    const value = {
      commands: [{ name: "section", snippet: "\\section{${1}}", detail: "heading", documentation: "Starts a section" }],
      environments: [{ name: "itemize", snippet: "\\begin{itemize}" }, { name: "enumerate" }],
    };
    expect(validateCoreCatalog(value)).toBe(value);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["missing environments", { commands: [] }],
    ["commands not an array", { commands: {}, environments: [] }],
    ["a command without a name", { commands: [{ snippet: "x" }], environments: [] }],
    ["a non-string detail", { commands: [{ name: "a", detail: 3 }], environments: [] }],
    ["a non-string documentation", { commands: [{ name: "a", documentation: false }], environments: [] }],
    ["an environment with a numeric snippet", { commands: [], environments: [{ name: "e", snippet: 1 }] }],
    ["an environment entry that is an array", { commands: [], environments: [["e"]] }],
  ])("rejects %s", (_label, value) => {
    expect(validateCoreCatalog(value)).toBeNull();
  });
});

describe("validatePackageCatalog", () => {
  it("accepts a full catalog and one without the legacy options list", () => {
    expect(validatePackageCatalog(PACKAGE)).toBe(PACKAGE);
    const { options: _options, ...withoutOptions } = PACKAGE;
    expect(validatePackageCatalog(withoutOptions)).toBe(withoutOptions);
  });

  it.each([
    ["deps with a number", { ...PACKAGE, deps: [1] }],
    ["macros not an array", { ...PACKAGE, macros: null }],
    ["a macro with unusual as a string", { ...PACKAGE, macros: [{ name: "m", unusual: "yes" }] }],
    ["a macro with non-string keys", { ...PACKAGE, macros: [{ name: "m", keys: [1] }] }],
    ["a macro with a string keyPos", { ...PACKAGE, macros: [{ name: "m", keyPos: "1" }] }],
    ["a macro with numeric documentation", { ...PACKAGE, macros: [{ name: "m", documentation: 1 }] }],
    ["envs not an array", { ...PACKAGE, envs: "tikzpicture" }],
    ["an env with a numeric detail", { ...PACKAGE, envs: [{ name: "e", detail: 2 }] }],
    ["an env with a non-boolean unusual", { ...PACKAGE, envs: [{ name: "e", unusual: 1 }] }],
    ["an env with keys as a string", { ...PACKAGE, envs: [{ name: "e", keys: "k" }] }],
    ["an env with a string keyPos", { ...PACKAGE, envs: [{ name: "e", keyPos: "0" }] }],
    ["keys as an array", { ...PACKAGE, keys: [] }],
    ["a keys entry holding a string", { ...PACKAGE, keys: { k: "v" } }],
    ["args missing", { ...PACKAGE, args: undefined }],
    ["options with a number", { ...PACKAGE, options: [1] }],
  ])("rejects %s", (_label, value) => {
    expect(validatePackageCatalog(value)).toBeNull();
  });
});

describe("validateAtSuggestions", () => {
  it("accepts an empty list and suggestions with or without detail", () => {
    expect(validateAtSuggestions([])).toEqual([]);
    const value = [
      { trigger: "@a", replacement: "\\alpha" },
      { trigger: "@b", replacement: "\\beta", detail: "beta" },
    ];
    expect(validateAtSuggestions(value)).toBe(value);
  });

  it.each([
    ["an object", { trigger: "@a", replacement: "\\alpha" }],
    ["a missing replacement", [{ trigger: "@a" }]],
    ["a numeric detail", [{ trigger: "@a", replacement: "x", detail: 1 }]],
    ["a non-record entry", ["@a"]],
  ])("rejects %s", (_label, value) => {
    expect(validateAtSuggestions(value)).toBeNull();
  });
});

describe("validateNameList", () => {
  it("accepts names with string details", () => {
    const value = { names: ["a", "b"], details: { a: "first" } };
    expect(validateNameList(value)).toBe(value);
  });

  it.each([
    ["a string", "a,b"],
    ["names not an array", { names: "a", details: {} }],
    ["details missing", { names: [] }],
    ["details as an array", { names: [], details: [] }],
    ["a numeric detail", { names: ["a"], details: { a: 1 } }],
  ])("rejects %s", (_label, value) => {
    expect(validateNameList(value)).toBeNull();
  });
});

describe("validateManifest", () => {
  it("accepts a manifest with or without a generated stamp", () => {
    expect(validateManifest(MANIFEST)).toBe(MANIFEST);
    const stamped = { ...MANIFEST, generated: "2026-01-01" };
    expect(validateManifest(stamped)).toBe(stamped);
  });

  it.each([
    ["undefined", undefined],
    ["a numeric source", { ...MANIFEST, source: 1 }],
    ["a numeric texlive", { ...MANIFEST, texlive: 2026 }],
    ["a missing license", { ...MANIFEST, license: undefined }],
    ["a missing generator", { ...MANIFEST, generatedBy: null }],
    ["a string catalog count", { ...MANIFEST, catalogs: "3" }],
    ["notices with a number", { ...MANIFEST, notices: [1] }],
  ])("rejects %s", (_label, value) => {
    expect(validateManifest(value)).toBeNull();
  });
});

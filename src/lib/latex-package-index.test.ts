import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  ctanUrl,
  documentClassLine,
  latexInstallMode,
  latexInstallState,
  loadedPackageNames,
  loadLatexPackageIndex,
  normalizePackageOptions,
  resetLatexPackageIndexCache,
  searchLatexPackages,
  usepackageEdit,
  usepackageLine,
  type LatexPackageEntry,
  type TextEdit,
} from "./latex-package-index";

function entry(overrides: Partial<LatexPackageEntry> & { name: string }): LatexPackageEntry {
  return { caption: "", ctan: true, bundled: false, ...overrides };
}

const PACKAGES = [
  entry({ name: "tablefootnote", caption: "Permit footnotes in tables" }),
  entry({ name: "booktabs", caption: "Publication quality tables in LaTeX", bundled: true }),
  entry({ name: "longtable", caption: "Allow tables to flow over page boundaries", bundled: true }),
  entry({ name: "tabularray", caption: "Typeset tabulars and arrays with LaTeX3" }),
  entry({ name: "amsmath", caption: "AMS mathematical facilities for LaTeX", bundled: true }),
  entry({ name: "ieeetran", caption: "Document class for IEEE Transactions", documentClass: "IEEEtran" }),
];

function apply(text: string, edit: TextEdit | string): string {
  if (typeof edit === "string") throw new Error(`expected an edit, got ${edit}`);
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

describe("searchLatexPackages", () => {
  it("ranks exact names, then prefixes, then captions", () => {
    const names = searchLatexPackages(PACKAGES, "table").map((pkg) => pkg.name);
    expect(names).toEqual(["tablefootnote", "longtable", "booktabs"]);
    expect(searchLatexPackages(PACKAGES, "booktabs")[0].name).toBe("booktabs");
    expect(searchLatexPackages(PACKAGES, "tab").map((pkg) => pkg.name)).toEqual([
      "tablefootnote",
      "tabularray",
      "booktabs",
      "longtable",
    ]);
  });

  it("needs every word to match the name or the caption", () => {
    expect(searchLatexPackages(PACKAGES, "ams facilities").map((pkg) => pkg.name)).toEqual(["amsmath"]);
    expect(searchLatexPackages(PACKAGES, "ams tables")).toEqual([]);
    expect(searchLatexPackages(PACKAGES, "IEEE").map((pkg) => pkg.name)).toEqual(["ieeetran"]);
  });

  it("lists bundled packages first when nothing is typed", () => {
    expect(searchLatexPackages(PACKAGES, "  ").map((pkg) => pkg.name)).toEqual([
      "amsmath",
      "booktabs",
      "longtable",
      "ieeetran",
      "tablefootnote",
      "tabularray",
    ]);
  });
});

describe("package lines and links", () => {
  it("writes usepackage and documentclass lines", () => {
    expect(usepackageLine("booktabs", "")).toBe("\\usepackage{booktabs}");
    expect(usepackageLine("geometry", "margin=1in")).toBe("\\usepackage[margin=1in]{geometry}");
    expect(documentClassLine("IEEEtran")).toBe("\\documentclass{IEEEtran}");
  });

  it("links to the CTAN page", () => {
    expect(ctanUrl("booktabs")).toBe("https://ctan.org/pkg/booktabs");
    expect(ctanUrl("IEEEtran")).toBe("https://ctan.org/pkg/ieeetran");
  });

  it("accepts plain options and rejects ones that would break the line", () => {
    expect(normalizePackageOptions("")).toBe("");
    expect(normalizePackageOptions("  margin=1in,\n  a4paper ")).toBe("margin=1in, a4paper");
    expect(normalizePackageOptions("font={\\small]}")).toBe("font={\\small]}");
    expect(normalizePackageOptions("a]b")).toBeNull();
    expect(normalizePackageOptions("a{b")).toBeNull();
    expect(normalizePackageOptions("a}b{")).toBeNull();
    expect(normalizePackageOptions("draft % note")).toBeNull();
  });
});

describe("loadedPackageNames", () => {
  it("collects packages from every file and skips comments", () => {
    const loaded = loadedPackageNames([
      "\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath, AMSSYMB}\n% \\usepackage{booktabs}\n\\input{preamble}\n",
      "\\RequirePackage{xcolor}\n\\usepackage\n  {graphicx}\n100\\% done \\usepackage{hyperref}\n",
    ]);
    expect([...loaded].sort()).toEqual(["amsmath", "amssymb", "graphicx", "hyperref", "inputenc", "xcolor"]);
  });
});

describe("usepackageEdit", () => {
  const document = "\\begin{document}\nHello\n\\end{document}\n";

  it("adds the first package right after the document class", () => {
    const text = `\\documentclass[11pt]{article}\n${document}`;
    expect(apply(text, usepackageEdit(text, "booktabs", ""))).toBe(
      `\\documentclass[11pt]{article}\n\\usepackage{booktabs}\n${document}`,
    );
  });

  it("adds after the last package and writes the options", () => {
    const text = `\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage[\n  margin=1in,\n]{geometry} % page\n\n\\title{T}\n${document}`;
    expect(apply(text, usepackageEdit(text, "booktabs", "draft"))).toBe(
      `\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage[\n  margin=1in,\n]{geometry} % page\n\\usepackage[draft]{booktabs}\n\n\\title{T}\n${document}`,
    );
  });

  it("never adds a package the main file already loads", () => {
    for (const text of [
      `\\documentclass{article}\n\\usepackage{booktabs}\n${document}`,
      `\\documentclass{article}\n\\usepackage[x]{amsmath,booktabs}\n${document}`,
      `\\documentclass{article}\n\\RequirePackage{booktabs}\n${document}`,
      `\\documentclass{article}\n\\usepackage{ BookTabs }\n${document}`,
    ]) {
      expect(usepackageEdit(text, "booktabs", "")).toBe("loaded");
    }
  });

  it("ignores packages and document markers inside comments", () => {
    const text = `\\documentclass{article}\n\\usepackage{amsmath}\n% \\usepackage{booktabs}\n% \\begin{document}\n\\usepackage{xcolor}\n${document}`;
    expect(apply(text, usepackageEdit(text, "booktabs", ""))).toBe(
      `\\documentclass{article}\n\\usepackage{amsmath}\n% \\usepackage{booktabs}\n% \\begin{document}\n\\usepackage{xcolor}\n\\usepackage{booktabs}\n${document}`,
    );
  });

  it("keeps hyperref and cleveref last", () => {
    const text = `\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{hyperref}\n\\usepackage{cleveref}\n${document}`;
    expect(apply(text, usepackageEdit(text, "booktabs", ""))).toBe(
      `\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{booktabs}\n\\usepackage{hyperref}\n\\usepackage{cleveref}\n${document}`,
    );
    expect(apply(text, usepackageEdit(text, "bookmark", ""))).toBe(
      `\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{hyperref}\n\\usepackage{cleveref}\n\\usepackage{bookmark}\n${document}`,
    );
    const onlyHyperref = `\\documentclass{article}\n\\usepackage{hyperref}\n${document}`;
    expect(apply(onlyHyperref, usepackageEdit(onlyHyperref, "booktabs", ""))).toBe(
      `\\documentclass{article}\n\\usepackage{booktabs}\n\\usepackage{hyperref}\n${document}`,
    );
  });

  it("never adds before the document class or inside the body", () => {
    const text = `\\RequirePackage{fix-cm}\n\\documentclass{article}\n\\begin{document}\n\\usepackage{late}\n\\end{document}\n`;
    expect(apply(text, usepackageEdit(text, "booktabs", ""))).toBe(
      `\\RequirePackage{fix-cm}\n\\documentclass{article}\n\\usepackage{booktabs}\n\\begin{document}\n\\usepackage{late}\n\\end{document}\n`,
    );
  });

  it("falls back to the line before begin document, or refuses", () => {
    expect(apply(document, usepackageEdit(document, "booktabs", ""))).toBe(`\\usepackage{booktabs}\n${document}`);
    expect(usepackageEdit("Just some text\n", "booktabs", "")).toBe("no-preamble");
    expect(apply("\\documentclass{article}", usepackageEdit("\\documentclass{article}", "booktabs", ""))).toBe(
      "\\documentclass{article}\n\\usepackage{booktabs}",
    );
  });
});

describe("install state", () => {
  it("follows the project's engine", () => {
    expect(latexInstallMode("latex", null)).toBe("on-demand");
    expect(latexInstallMode("latex", "/tex/bin/tlmgr")).toBe("on-demand");
    expect(latexInstallMode("latexmk", "/tex/bin/tlmgr")).toBe("tlmgr");
    expect(latexInstallMode("latexmk", null)).toBe("unknown");
    expect(latexInstallMode("typst", "/tex/bin/tlmgr")).toBe("unknown");
  });

  it("reads tlmgr's installed list and offers installs only for CTAN packages", () => {
    const installed = new Set(["booktabs", "ieeetran"]);
    const booktabs = PACKAGES[1];
    const amsmath = PACKAGES[4];
    expect(latexInstallState(booktabs, "on-demand", installed, true)).toBe("on-demand");
    expect(latexInstallState(booktabs, "tlmgr", installed, true)).toBe("installed");
    expect(latexInstallState(amsmath, "tlmgr", installed, true)).toBe("missing");
    expect(latexInstallState(PACKAGES[5], "tlmgr", installed, true)).toBe("installed");
    expect(latexInstallState(amsmath, "tlmgr", installed, false)).toBe("unknown");
    expect(latexInstallState({ ...amsmath, ctan: false }, "tlmgr", installed, true)).toBe("unknown");
    expect(latexInstallState({ ...booktabs, ctan: false }, "tlmgr", installed, true)).toBe("installed");
    expect(latexInstallState(booktabs, "unknown", installed, true)).toBe("unknown");
  });
});

describe("loadLatexPackageIndex", () => {
  const INDEX = { source: "ctan", fetchedAt: 10, stale: false, packages: PACKAGES };

  beforeEach(() => {
    resetLatexPackageIndexCache();
    invoke.mockReset();
    invoke.mockResolvedValue(INDEX);
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 2));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the backend once and reuses the list", async () => {
    expect(await loadLatexPackageIndex({ offline: false })).toBe(INDEX);
    await loadLatexPackageIndex({ offline: false });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("latex_package_index", { offline: false, refresh: false });
    await loadLatexPackageIndex({ offline: false, refresh: true });
    expect(invoke).toHaveBeenLastCalledWith("latex_package_index", { offline: false, refresh: true });
    await loadLatexPackageIndex({ offline: true });
    expect(invoke).toHaveBeenLastCalledWith("latex_package_index", { offline: true, refresh: false });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("tries CTAN again soon after it fell back to the bundled list", async () => {
    invoke.mockResolvedValue({ ...INDEX, source: "bundled", fetchedAt: null });
    await loadLatexPackageIndex({ offline: false });
    await loadLatexPackageIndex({ offline: false });
    expect(invoke).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(61_000);
    await loadLatexPackageIndex({ offline: false });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

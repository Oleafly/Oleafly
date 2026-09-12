import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  REGISTRY,
  deferredRoutes,
  exportRoutesFor,
  importRouteFor,
  importRoutes,
  type ConversionRoute,
} from "./index.ts";
import { generateMatrixMarkdown } from "./matrix.ts";

const uniqueIds = new Set<string>();

describe("conversion registry invariants", () => {
  it("has unique route ids", () => {
    for (const route of REGISTRY) {
      expect(uniqueIds.has(route.id), route.id).toBe(false);
      uniqueIds.add(route.id);
    }
  });

  it("gives every deferred route a reason and a gap id", () => {
    for (const route of deferredRoutes()) {
      expect(route.deferredReason, route.id).toBeTruthy();
      expect(route.gapId, route.id).toMatch(/^G\d+$/);
    }
  });

  it("keeps pandoc import routes in lockstep with the Rust plan table", () => {
    // Mirrors conversion::tests::conversion_routes_cover_the_registry_matrix.
    const expected: Array<[string, string]> = [
      ["docx", "latex"],
      ["docx", "markdown"],
      ["docx", "typst"],
      ["md", "latex"],
      ["md", "typst"],
      ["html", "latex"],
      ["html", "markdown"],
      ["html", "typst"],
      ["typ", "latex"],
      ["typ", "markdown"],
    ];
    const actual = REGISTRY.filter((route) => route.direction === "import" && route.pandoc)
      .map((route) => [route.extensions?.[0] ?? "", targetKind(route)] as [string, string]);
    expect(new Set(actual.map((pair) => pair.join(">")))).toEqual(
      new Set(expected.map((pair) => pair.join(">"))),
    );
  });

  it("resolves an import route for a picked extension and target", () => {
    expect(importRouteFor("html", "latex")?.id).toBe("html-to-latex");
    expect(importRouteFor("docx", "markdown")?.id).toBe("docx-to-markdown");
    expect(importRouteFor("typ", "typst")).toBeUndefined();
  });

  it("orders export routes per engine and drops unavailable formats", () => {
    const latex = exportRoutesFor("latex", ["docx", "html", "md", "typst", "txt"]);
    expect(latex.map((route) => route.id)).toEqual([
      "latex-to-docx",
      "latex-to-html",
      "latex-to-markdown",
      "latex-to-typst",
    ]);
    const typst = exportRoutesFor("typst", ["pdf", "tex", "docx", "html", "md", "txt"]);
    expect(typst.map((route) => route.id)).toEqual([
      "typst-to-pdf",
      "typst-to-latex",
      "typst-to-docx",
      "typst-to-html",
      "typst-to-markdown",
    ]);
  });

  it("lists import routes for the Import dialog", () => {
    const ids = importRoutes().map((route) => route.id);
    for (const id of [
      "docx-to-latex",
      "docx-to-markdown",
      "docx-to-typst",
      "markdown-to-latex",
      "markdown-to-typst",
      "html-to-latex",
      "html-to-markdown",
      "html-to-typst",
      "typst-to-latex",
      "typst-to-markdown",
    ]) {
      expect(ids, id).toContain(id);
    }
  });
});

describe("docs/conversion-matrix.md stays generated", () => {
  it("matches the committed file", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const committed = readFileSync(resolve(repoRoot, "docs/conversion-matrix.md"), "utf8");
    expect(committed).toBe(generateMatrixMarkdown());
  });
});

function targetKind(route: ConversionRoute): string {
  switch (route.target) {
    case "latex":
      return "latex";
    case "markdown":
      return "markdown";
    case "typst":
      return "typst";
    default:
      return `?${route.target}`;
  }
}

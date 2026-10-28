import { describe, expect, it } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { CompileResult, DocumentEngineDescriptor } from "@/lib/tauri";
import {
  compiledHtmlOutput,
  isCalepinEngine,
  isNotebookEngine,
  isQuartoEngine,
  isQuartoSourcePath,
  notebookEngineId,
  notebookOutput,
  usesCalepin,
} from "./notebook-engines";

function engine(id: string, extra: Record<string, unknown> = {}): DocumentEngineDescriptor {
  return { ...LATEX_ENGINE, id, ...extra } as unknown as DocumentEngineDescriptor;
}

function result(extra: Record<string, unknown> = {}): CompileResult {
  return {
    ok: true,
    has_pdf: false,
    output_id: null,
    output_revision: null,
    log: "",
    errors: [],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 0,
    ...extra,
  } as CompileResult;
}

describe("notebook engine ids", () => {
  it("names Quarto and Calepin and nothing else", () => {
    expect(notebookEngineId(engine("quarto"))).toBe("quarto");
    expect(notebookEngineId(engine("calepin"))).toBe("calepin");
    expect(notebookEngineId(engine("typst"))).toBeNull();
    expect(notebookEngineId(LATEX_ENGINE)).toBeNull();
    expect(notebookEngineId(null)).toBeNull();
    expect(notebookEngineId(undefined)).toBeNull();
  });

  it("tells the two notebook engines apart", () => {
    expect(isNotebookEngine(engine("quarto"))).toBe(true);
    expect(isNotebookEngine(engine("calepin"))).toBe(true);
    expect(isNotebookEngine(engine("markdown"))).toBe(false);
    expect(isQuartoEngine(engine("quarto"))).toBe(true);
    expect(isQuartoEngine(engine("calepin"))).toBe(false);
    expect(isCalepinEngine(engine("calepin"))).toBe(true);
    expect(isCalepinEngine(engine("typst"))).toBe(false);
  });
});

describe("notebook output", () => {
  it("is HTML only when a notebook engine says so and PDF otherwise", () => {
    expect(notebookOutput(engine("quarto", { notebook_output: "html" }))).toBe("html");
    expect(notebookOutput(engine("quarto", { notebook_output: "pdf" }))).toBe("pdf");
    expect(notebookOutput(engine("quarto"))).toBe("pdf");
    expect(notebookOutput(engine("calepin", { notebook_output: "revealjs" }))).toBe("pdf");
  });

  it("is null for engines that are not notebooks", () => {
    expect(notebookOutput(engine("typst", { notebook_output: "html" }))).toBeNull();
    expect(notebookOutput(null)).toBeNull();
  });
});

describe("compiled HTML output", () => {
  it("reads the HTML path a compile wrote", () => {
    expect(compiledHtmlOutput(result({ html_output: "/p/.oleafly/build/index.html" }))).toBe(
      "/p/.oleafly/build/index.html",
    );
  });

  it("ignores a missing, empty or malformed path", () => {
    expect(compiledHtmlOutput(result())).toBeNull();
    expect(compiledHtmlOutput(result({ html_output: null }))).toBeNull();
    expect(compiledHtmlOutput(result({ html_output: "" }))).toBeNull();
    expect(compiledHtmlOutput(result({ html_output: 42 }))).toBeNull();
    expect(compiledHtmlOutput(null)).toBeNull();
  });
});

describe("notebook sources", () => {
  it("recognizes Quarto and R Markdown files in any case", () => {
    expect(isQuartoSourcePath("report.qmd")).toBe(true);
    expect(isQuartoSourcePath("chapters/analysis.Rmd")).toBe(true);
    expect(isQuartoSourcePath("NOTES.QMD")).toBe(true);
    expect(isQuartoSourcePath("main.md")).toBe(false);
    expect(isQuartoSourcePath(".qmd")).toBe(false);
    expect(isQuartoSourcePath(null)).toBe(false);
  });

  it("finds the Calepin import in a Typst document", () => {
    expect(usesCalepin('#import "/.calepin/calepin.typ"\n#show: calepin.document\n')).toBe(true);
    expect(usesCalepin('#import "/.calepin/theme/calepin.typ": *\n')).toBe(true);
    expect(usesCalepin('#import "@preview/cetz:0.3.4"\n')).toBe(false);
    expect(usesCalepin('#import "/calepin.typ"\n')).toBe(false);
  });
});

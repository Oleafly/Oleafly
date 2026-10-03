import { describe, expect, it } from "vitest";
import {
  figureToolEngine,
  supportsFigureTools,
  compileOfflineForEngine,
  compileSettingsForEngine,
  formattingForEngine,
  LATEX_ENGINE,
  pathUsesEngineSource,
  UNKNOWN_ENGINE,
} from "./document-engine";

describe("pathUsesEngineSource", () => {
  it("rejects cross-engine files and accepts declared source extensions", () => {
    expect(pathUsesEngineSource(LATEX_ENGINE, "chapters/main.tex")).toBe(true);
    expect(pathUsesEngineSource(LATEX_ENGINE, "README.md")).toBe(false);
    expect(pathUsesEngineSource(LATEX_ENGINE, "notes.typ")).toBe(false);
  });
});

describe("compileSettingsForEngine", () => {
  const withProfile = (
    id: "latexmk" | "typst" | "markdown",
    profile: "latex" | "typst" | "markdown",
  ) => ({
    ...LATEX_ENGINE,
    id,
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: profile },
  });

  it("offers every LaTeX compile setting on the bundled Tectonic engine", () => {
    expect(compileSettingsForEngine(LATEX_ENGINE)).toEqual({
      syntaxCheck: true,
      draftMode: true,
      stopOnFirstError: true,
    });
  });

  it("drops the draft mode for latexmk", () => {
    expect(compileSettingsForEngine(withProfile("latexmk", "latex"))).toEqual({
      syntaxCheck: true,
      draftMode: false,
      stopOnFirstError: true,
    });
  });

  it("offers none of them for Typst, Markdown or an unknown engine", () => {
    const none = { syntaxCheck: false, draftMode: false, stopOnFirstError: false };
    expect(compileSettingsForEngine(withProfile("typst", "typst"))).toEqual(none);
    expect(compileSettingsForEngine(withProfile("markdown", "markdown"))).toEqual(none);
    expect(compileSettingsForEngine(UNKNOWN_ENGINE)).toEqual(none);
  });
});

describe("compileOfflineForEngine", () => {
  it("preserves supported LaTeX offline compilation", () => {
    expect(compileOfflineForEngine(LATEX_ENGINE, true)).toEqual({ offline: true, notice: null });
  });

  it("does not brick Typst when the global offline preference is enabled", () => {
    const typst = {
      ...LATEX_ENGINE,
      id: "typst" as const,
      label: "Typst",
      source_format: "typst" as const,
      main_document: "main.typ",
      source_extensions: ["typ"],
      capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" as const, supports_offline: false },
    };
    expect(compileOfflineForEngine(typst, true)).toEqual({
      offline: false,
      notice: "Typst does not expose an offline compiler mode. Compiling normally.",
    });
  });
});

describe("formattingForEngine", () => {
  const typst = {
    ...LATEX_ENGINE,
    id: "typst" as const,
    label: "Typst",
    source_format: "typst" as const,
    main_document: "main.typ",
    source_extensions: ["typ"],
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" as const },
  };
  const markdown = { ...LATEX_ENGINE, id: "markdown" as const, label: "Markdown / Pandoc", source_format: "markdown" as const, main_document: "main.md", source_extensions: ["md", "markdown"], capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "markdown" as const } };

  it("is unavailable and returns no mutation while the engine is unresolved", () => {
    for (const action of ["bold", "italic", "section", "list"] as const) {
      expect(formattingForEngine(UNKNOWN_ENGINE, false, action)).toBeNull();
    }
  });

  it("returns LaTeX formatting only after LaTeX resolves", () => {
    expect(formattingForEngine(LATEX_ENGINE, true, "bold")).toEqual({
      kind: "wrap",
      before: "\\textbf{",
      after: "}",
    });
    expect(formattingForEngine(LATEX_ENGINE, true, "italic")).toEqual({
      kind: "wrap",
      before: "\\textit{",
      after: "}",
    });
    expect(formattingForEngine(LATEX_ENGINE, true, "section")).toEqual({
      kind: "insert",
      text: "\\section{}\n",
    });
    expect(formattingForEngine(LATEX_ENGINE, true, "list")).toEqual({
      kind: "insert",
      text: "\\begin{itemize}\n  \\item \n\\end{itemize}\n",
    });
  });

  it("returns Typst formatting only after Typst resolves", () => {
    expect(formattingForEngine(typst, true, "bold")).toEqual({
      kind: "wrap",
      before: "*",
      after: "*",
    });
    expect(formattingForEngine(typst, true, "italic")).toEqual({
      kind: "wrap",
      before: "_",
      after: "_",
    });
    expect(formattingForEngine(typst, true, "section")).toEqual({
      kind: "insert",
      text: "= Heading\n",
    });
    expect(formattingForEngine(typst, true, "list")).toEqual({
      kind: "insert",
      text: "- Item\n",
    });
  });

  it("returns safe Pandoc Markdown formatting", () => {
    expect(formattingForEngine(markdown, true, "bold")).toEqual({ kind: "wrap", before: "**", after: "**" });
    expect(formattingForEngine(markdown, true, "italic")).toEqual({ kind: "wrap", before: "*", after: "*" });
    expect(formattingForEngine(markdown, true, "section")).toEqual({ kind: "insert", text: "# Heading\n" });
    expect(formattingForEngine(markdown, true, "list")).toEqual({ kind: "insert", text: "- Item\n" });
  });
});

describe("supportsFigureTools", () => {
  const typst = {
    ...LATEX_ENGINE,
    id: "typst" as const,
    capabilities: {
      ...LATEX_ENGINE.capabilities,
      formatting_profile: "typst" as const,
      supports_isolated_compile: false,
    },
  };
  const markdown = {
    ...LATEX_ENGINE,
    id: "markdown" as const,
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "markdown" as const },
  };
  const latexWithoutIsolation = {
    ...LATEX_ENGINE,
    capabilities: { ...LATEX_ENGINE.capabilities, supports_isolated_compile: false },
  };

  it("needs isolated compilation for LaTeX figures", () => {
    expect(supportsFigureTools(LATEX_ENGINE)).toBe(true);
    expect(supportsFigureTools(LATEX_ENGINE, false)).toBe(false);
    expect(supportsFigureTools(latexWithoutIsolation)).toBe(false);
    expect(figureToolEngine(LATEX_ENGINE)).toBe("latex");
  });

  it("renders Typst figures through the snippet renderer instead of an isolated compile", () => {
    expect(supportsFigureTools(typst)).toBe(true);
    expect(supportsFigureTools(typst, false)).toBe(false);
    expect(figureToolEngine(typst)).toBe("typst");
  });

  it("offers no figure engine for Markdown or an unknown engine", () => {
    expect(supportsFigureTools(markdown)).toBe(false);
    expect(supportsFigureTools(UNKNOWN_ENGINE)).toBe(false);
    expect(figureToolEngine(markdown)).toBeNull();
    expect(figureToolEngine(UNKNOWN_ENGINE)).toBeNull();
  });
});

describe("serialized capability consumers", () => {
  it("uses profiles and sets instead of inferring policy from ids", () => {
    const markdownWithAnUnfamiliarId = {
      ...LATEX_ENGINE,
      id: "unknown" as const,
      label: "Custom Markdown",
      source_format: "markdown" as const,
      capabilities: {
        ...LATEX_ENGINE.capabilities,
        formatting_profile: "markdown" as const,
        conversion_exports: ["docx", "html"] as ("docx" | "html")[],
      },
    };
    expect(formattingForEngine(markdownWithAnUnfamiliarId, true, "bold")).toEqual({
      kind: "wrap",
      before: "**",
      after: "**",
    });
  });
});

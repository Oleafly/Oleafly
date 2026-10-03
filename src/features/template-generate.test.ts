import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  compileIsolated: vi.fn(),
  getConfig: vi.fn(),
  getOrCreateScratchProject: vi.fn(),
  readIsolatedPdf: vi.fn(),
  renderTypstSnippet: vi.fn(),
  saveCustomTemplate: vi.fn(),
}));
const pdfPageToPng = vi.hoisted(() => vi.fn());
const completeViaBackend = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng }));
vi.mock("@/lib/tauri", () => tauri);
vi.mock("@/lib/agent-backend", () => ({ completeViaBackend }));
vi.mock("@/lib/ai-providers", () => ({
  hasConfiguredProvider: vi.fn(),
  resolveActiveModel: vi.fn(),
}));

import {
  compileGeneratedTemplate,
  generateTemplateSource,
  parseGeneratedTemplate,
  type ParsedTemplate,
} from "./template-generate";

describe("parseGeneratedTemplate", () => {
  const valid = JSON.stringify({
    slug: "My Slug!",
    name: "My Template",
    description: "d",
    category: "Custom",
    engine: "xetex",
    main_doc: "main.tex",
    source: "\\documentclass{article}\\begin{document}x\\end{document}",
  });

  it("parses plain JSON and sanitizes the slug", () => {
    const t = parseGeneratedTemplate(valid);
    expect(t.slug).toBe("my-slug");
    expect(t.engine).toBe("xetex");
    expect(t.mainDoc).toBe("main.tex");
  });

  it("strips markdown fences", () => {
    const t = parseGeneratedTemplate(`\`\`\`json\n${valid}\n\`\`\``);
    expect(t.name).toBe("My Template");
  });

  it("rejects unsupported engines", () => {
    const bad = valid.replace("xetex", "pdflatex-shell-escape");
    expect(() => parseGeneratedTemplate(bad)).toThrow(/unsupported engine/);
  });

  it("rejects empty source", () => {
    const bad = JSON.stringify({ slug: "a", engine: "typst", source: "  " });
    expect(() => parseGeneratedTemplate(bad)).toThrow(/missing source/);
  });

  it("defaults main_doc by engine", () => {
    const t = parseGeneratedTemplate(
      JSON.stringify({ slug: "a", engine: "typst", source: "= Title" }),
    );
    expect(t.mainDoc).toBe("main.typ");
  });
});

function template(overrides: Partial<ParsedTemplate>): ParsedTemplate {
  return {
    slug: "draft",
    name: "Draft",
    description: "",
    category: "Custom",
    tags: [],
    engine: "typst",
    mainDoc: "main.typ",
    source: "= Title\n\nBody text.",
    ...overrides,
  };
}

describe("compileGeneratedTemplate", () => {
  beforeEach(() => {
    for (const mock of Object.values(tauri)) mock.mockReset();
    pdfPageToPng.mockReset();
  });

  it("renders page 1 of a Typst draft as a PNG preview without the snippet preamble", async () => {
    tauri.renderTypstSnippet.mockResolvedValue({
      status: "rendered",
      image: { format: "png", pngBase64: "iVBORw0KGgo=" },
      diagnostics: [{ severity: "warning", message: "unused label", line: 3, column: 1 }],
    });
    const result = await compileGeneratedTemplate(template({}));
    expect(tauri.renderTypstSnippet).toHaveBeenCalledWith({
      source: "= Title\n\nBody text.",
      format: "png",
      ppi: 108,
      document: true,
    });
    expect(result).toEqual({
      png: "data:image/png;base64,iVBORw0KGgo=",
      log: "main.typ:3:1: warning: unused label",
    });
    expect(tauri.compileIsolated).not.toHaveBeenCalled();
    expect(pdfPageToPng).not.toHaveBeenCalled();
  });

  it("returns the Typst compile log and no preview when the draft fails", async () => {
    tauri.renderTypstSnippet.mockResolvedValue({
      status: "failed",
      diagnostics: [
        { severity: "error", message: "unclosed delimiter", line: 2, column: 9 },
        { severity: "error", message: "Typst stopped with exit code 1.", line: null, column: null },
      ],
    });
    const result = await compileGeneratedTemplate(template({ mainDoc: "paper.typ" }));
    expect(result).toEqual({
      png: null,
      log: "paper.typ:2:9: error: unclosed delimiter\nerror: Typst stopped with exit code 1.",
    });
  });

  it("keeps only the tail of a long Typst log", async () => {
    tauri.renderTypstSnippet.mockResolvedValue({
      status: "failed",
      diagnostics: Array.from({ length: 32 }, (_, index) => ({
        severity: "error",
        message: `problem ${index} ${"x".repeat(100)}`,
        line: index + 1,
        column: 1,
      })),
    });
    const { log } = await compileGeneratedTemplate(template({}));
    expect(log).toHaveLength(2000);
    expect(log.endsWith(`problem 31 ${"x".repeat(100)}`)).toBe(true);
  });

  it("still compiles LaTeX drafts through the isolated scratch project", async () => {
    tauri.getOrCreateScratchProject.mockResolvedValue("scratch");
    tauri.compileIsolated.mockResolvedValue({ has_pdf: true, log: "Output written" });
    tauri.readIsolatedPdf.mockResolvedValue([37, 80, 68, 70]);
    pdfPageToPng.mockResolvedValue("data:image/png;base64,TEX");
    const result = await compileGeneratedTemplate(
      template({ engine: "xetex", mainDoc: "main.tex", source: "\\documentclass{article}" }),
    );
    expect(result).toEqual({ png: "data:image/png;base64,TEX", log: "Output written" });
    expect(tauri.compileIsolated).toHaveBeenCalledWith("scratch", "\\documentclass{article}");
    expect(tauri.renderTypstSnippet).not.toHaveBeenCalled();
  });

  it("does not try to preview Markdown drafts", async () => {
    const result = await compileGeneratedTemplate(
      template({ engine: "markdown", mainDoc: "main.md", source: "# Title" }),
    );
    expect(result).toEqual({ png: null, log: "" });
    expect(tauri.renderTypstSnippet).not.toHaveBeenCalled();
    expect(tauri.compileIsolated).not.toHaveBeenCalled();
  });
});

describe("generateTemplateSource", () => {
  it("tells the model how to write Typst that compiles offline", async () => {
    completeViaBackend.mockResolvedValue({
      text: JSON.stringify({ slug: "a", engine: "typst", source: "= Title" }),
    });
    await generateTemplateSource("a short report");
    const [{ system }] = completeViaBackend.mock.calls[0] as [{ system: string }];
    expect(system).toContain("Typst 0.13");
    expect(system).toContain("@preview");
    expect(system).toMatch(/no images/i);
  });
});

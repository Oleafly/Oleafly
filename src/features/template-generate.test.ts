import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  compileIsolated: vi.fn(),
  getConfig: vi.fn(),
  readIsolatedPdf: vi.fn(),
  saveCustomTemplate: vi.fn(),
}));
vi.mock("@/lib/ai-providers", () => ({
  hasConfiguredProvider: vi.fn(),
  resolveActiveModel: vi.fn(),
}));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ projectId: null }) },
}));

import { parseGeneratedTemplate } from "./template-generate";

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
    const t = parseGeneratedTemplate("```json\n" + valid + "\n```");
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

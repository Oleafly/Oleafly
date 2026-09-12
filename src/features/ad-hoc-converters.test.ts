// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convertAdHoc: vi.fn(),
  ensurePandoc: vi.fn(),
  completeViaBackend: vi.fn(),
  convertPages: vi.fn(),
  getConfig: vi.fn(),
  listOllamaModels: vi.fn(),
  extractArxivSource: vi.fn(),
  extractPagesForConvert: vi.fn(),
  emitTable: vi.fn(),
  pdfPageToPng: vi.fn(),
  readTableRowsFromBytes: vi.fn(),
  renderDiagram: vi.fn(),
  svgDocumentToPngBytes: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  convertAdHoc: mocks.convertAdHoc,
  extractArxivSource: mocks.extractArxivSource,
  getConfig: mocks.getConfig,
}));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));
vi.mock("@/lib/agent-backend", () => ({ completeViaBackend: mocks.completeViaBackend }));
vi.mock("@/lib/ollama", () => ({
  DEFAULT_OLLAMA_HOST: "http://127.0.0.1:11434",
  listOllamaModels: mocks.listOllamaModels,
}));
vi.mock("@/features/table-import", () => ({
  emitTable: mocks.emitTable,
  readTableRowsFromBytes: mocks.readTableRowsFromBytes,
}));
vi.mock("@oleafly/pdf-to-latex", () => ({ convertPages: mocks.convertPages }));
vi.mock("@oleafly/pdf-to-latex/pdf-adapter", () => ({
  extractPagesForConvert: mocks.extractPagesForConvert,
}));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: mocks.pdfPageToPng }));
vi.mock("@/components/ui/mermaid-diagram", () => ({ renderDiagram: mocks.renderDiagram }));
vi.mock("@/features/equation-export", () => ({
  svgDocumentToPngBytes: mocks.svgDocumentToPngBytes,
}));

import {
  AD_HOC_CONVERTERS,
  projectReadySource,
  runAdHocConverter,
  transcribePdfPages,
} from "./ad-hoc-converters";

const converted = {
  kind: "text" as const,
  text: "converted",
  dataBase64: null,
  fileName: "converted.tex",
  mediaType: "application/x-tex",
  files: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePandoc.mockResolvedValue(true);
  mocks.convertAdHoc.mockResolvedValue(converted);
  mocks.getConfig.mockResolvedValue({
    ai_keys: { ollama: "http://127.0.0.1:11434" },
    ai_provider: "ollama",
    ai_model: "qwen2.5vl:7b",
  });
  mocks.listOllamaModels.mockResolvedValue(["qwen2.5vl:7b"]);
  mocks.completeViaBackend.mockResolvedValue({ text: "x^2" });
  mocks.convertPages.mockReturnValue({
    tex: "\\documentclass{article}\\begin{document}PDF text\\end{document}",
    report: { pages: 1, figures: 0, likelyScanned: false },
  });
  mocks.extractPagesForConvert.mockResolvedValue({ pages: [{}], figures: [] });
  mocks.pdfPageToPng.mockResolvedValue("data:image/png;base64,iVBORw0KGgo=");
  mocks.renderDiagram.mockResolvedValue({ outerHTML: '<svg xmlns="http://www.w3.org/2000/svg" />' });
  mocks.svgDocumentToPngBytes.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
});

describe("ad-hoc converter registry", () => {
  it("wraps a LaTeX fragment only when a compilable project needs it", () => {
    const fragment = "\\begin{tabular}{ll}A & B\\end{tabular}";
    expect(projectReadySource("latex", fragment)).toContain("\\documentclass{article}");
    expect(projectReadySource("latex", fragment)).toContain(fragment);

    const document = "\\documentclass{article}\\begin{document}x\\end{document}";
    expect(projectReadySource("latex", document)).toBe(document);
    expect(projectReadySource("typst", "= Title")).toBe("= Title");
  });

  it("gives text converters examples and leaves asset converters empty", () => {
    for (const definition of Object.values(AD_HOC_CONVERTERS)) {
      if (definition.inputKind === "text" || definition.inputKind === "image-or-text") {
        expect(definition.example, definition.id).toBeTruthy();
      }
      if (definition.inputKind === "file") {
        expect(definition.example, definition.id).toBeUndefined();
      }
    }
  });

  it.each([
    ["html-to-latex", "html", "latex"],
    ["latex-to-html", "latex", "html"],
    ["latex-to-markdown", "latex", "markdown"],
    ["latex-to-typst", "latex", "typst"],
    ["latex-to-word", "latex", "docx"],
    ["markdown-to-latex", "markdown", "latex"],
    ["markdown-to-typst", "markdown", "typst"],
    ["typst-to-latex", "typst", "latex"],
  ] as const)("routes %s through the native Pandoc boundary", async (id, source, target) => {
    await expect(runAdHocConverter(id, { text: "source", file: null })).resolves.toEqual(
      converted,
    );
    expect(mocks.ensurePandoc).toHaveBeenCalledOnce();
    expect(mocks.convertAdHoc).toHaveBeenCalledWith({ source, target, text: "source" });
  });

  it("normalizes common Unicode equation symbols without requiring a model", async () => {
    const result = await runAdHocConverter("equation-to-latex", {
      text: "e^(iπ) + 1 = 0",
      file: null,
    });
    expect(result.text).toBe("e^{i\\pi} + 1 = 0");
    expect(mocks.completeViaBackend).not.toHaveBeenCalled();
  });

  it("converts a spreadsheet with the bounded shared table parser", async () => {
    mocks.readTableRowsFromBytes.mockResolvedValue([
      ["Method", "Score"],
      ["Oleafly", "0.95"],
    ]);
    mocks.emitTable.mockReturnValue("\\begin{tabular}{lr}");
    const file = new File(["Method,Score\nOleafly,0.95"], "results.csv");
    const result = await runAdHocConverter("excel-to-latex", { text: "", file });
    expect(result.text).toContain("tabular");
    expect(mocks.emitTable).toHaveBeenCalledWith(expect.any(Array), {
      target: "latex",
      header: true,
      boldHeader: true,
    });
  });

  it("accepts verified image bytes and always selects a local vision model", async () => {
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "equation.png",
      { type: "image/png" },
    );
    const result = await runAdHocConverter("image-to-latex", { text: "", file: png });
    expect(result.text).toBe("x^2");
    expect(mocks.completeViaBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ type: "image", image: expect.stringMatching(/^data:image\/png;base64,/) }),
            ]),
          }),
        ],
      }),
      undefined,
      { provider_id: "ollama", model_id: "qwen2.5vl:7b" },
    );
  });

  it("rejects a renamed non-image before it reaches a model", async () => {
    const fake = new File(["not an image"], "notes.png", { type: "image/png" });
    await expect(
      runAdHocConverter("image-to-latex", { text: "", file: fake }),
    ).rejects.toThrow("PNG, JPEG, or WebP");
    expect(mocks.completeViaBackend).not.toHaveBeenCalled();
  });

  it("renders advanced Mermaid diagrams locally instead of dropping unsupported syntax", async () => {
    const result = await runAdHocConverter("mermaid-to-latex", {
      text: "sequenceDiagram\nAlice->>Bob: Hello",
      file: null,
    });
    expect(result.text).toContain("includegraphics");
    expect(result.files).toEqual([
      expect.objectContaining({ path: "assets/diagram.png" }),
    ]);
    expect(mocks.renderDiagram).toHaveBeenCalledWith(
      "sequenceDiagram\nAlice->>Bob: Hello",
      "light",
    );
  });

  it("rejects oversized Mermaid input before loading the renderer", async () => {
    await expect(
      runAdHocConverter("mermaid-to-latex", {
        text: `flowchart TD\n${"a".repeat(50_001)}`,
        file: null,
      }),
    ).rejects.toThrow("50,000-character limit");
    expect(mocks.renderDiagram).not.toHaveBeenCalled();
  });

  it("reports a missing or oversized file before invoking a converter", async () => {
    await expect(
      runAdHocConverter("word-to-latex", { text: "", file: null }),
    ).rejects.toThrow("Choose a file");
    const oversized = { size: 128 * 1024 * 1024 + 1 } as File;
    await expect(
      runAdHocConverter("word-to-latex", { text: "", file: oversized }),
    ).rejects.toThrow("smaller than 128 MB");
    expect(mocks.convertAdHoc).not.toHaveBeenCalled();
  });

  it("converts Word bytes through the binary Pandoc route", async () => {
    const docx = new File([new Uint8Array([0x50, 0x4b, 3, 4])], "paper.docx");
    await runAdHocConverter("word-to-latex", { text: "", file: docx });
    expect(mocks.convertAdHoc).toHaveBeenCalledWith({
      source: "docx",
      target: "latex",
      dataBase64: "UEsDBA==",
    });
  });

  it("rejects an empty spreadsheet and reports its converted dimensions", async () => {
    const progress = vi.fn();
    const sheet = new File(["a,b"], "results.csv");
    mocks.readTableRowsFromBytes.mockResolvedValueOnce([]);
    await expect(
      runAdHocConverter("excel-to-latex", { text: "", file: sheet }, progress),
    ).rejects.toThrow("selected sheet is empty");

    mocks.readTableRowsFromBytes.mockResolvedValueOnce([
      ["Method", "Score"],
      ["Local", "0.95"],
    ]);
    mocks.emitTable.mockReturnValue("\\begin{tabular}{lr}");
    const output = await runAdHocConverter(
      "excel-to-latex",
      { text: "", file: sheet },
      progress,
    );
    expect(progress).toHaveBeenCalledWith({ step: "firstSheet" });
    expect(output.note).toBe("Converted 2 rows and 2 columns.");
  });

  it.each([
    ["image-to-latex", "LaTeX"],
    ["image-to-typst", "Typst"],
  ] as const)("transcribes %s with only a local vision model", async (id, target) => {
    const progress = vi.fn();
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], "notes.jpg");
    mocks.completeViaBackend.mockResolvedValue({ text: "```text\ntranscribed\n```" });
    const result = await runAdHocConverter(id, { text: "", file: jpeg }, progress);
    expect(result.text).toBe("transcribed");
    expect(progress).toHaveBeenCalledWith({ step: "visionModel" });
    expect(mocks.completeViaBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(`Return only ${target} source`),
      }),
      undefined,
      { provider_id: "ollama", model_id: "qwen2.5vl:7b" },
    );
  });

  it("recognizes WebP bytes and enforces the image-specific size limit", async () => {
    const webp = new File(
      [new TextEncoder().encode("RIFF1234WEBP")],
      "notes.webp",
    );
    await runAdHocConverter("image-to-latex", { text: "", file: webp });
    expect(mocks.completeViaBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({ image: expect.stringMatching(/^data:image\/webp;base64,/) }),
          ]),
        })],
      }),
      undefined,
      expect.any(Object),
    );

    const oversizedImage = {
      name: "large.png",
      size: 20 * 1024 * 1024 + 1,
      arrayBuffer: vi.fn(),
    } as unknown as File;
    await expect(
      runAdHocConverter("image-to-latex", { text: "", file: oversizedImage }),
    ).rejects.toThrow("smaller than 20 MB");
  });

  it("gives actionable local-model errors and never falls back to a cloud provider", async () => {
    const image = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "notes.png",
    );
    mocks.listOllamaModels.mockRejectedValueOnce(new Error("offline"));
    await expect(
      runAdHocConverter("image-to-latex", { text: "", file: image }),
    ).rejects.toThrow("Start Ollama in Settings");

    mocks.listOllamaModels.mockResolvedValueOnce(["llama3.2:3b"]);
    await expect(
      runAdHocConverter("image-to-latex", { text: "", file: image }),
    ).rejects.toThrow("Install a vision model in Ollama");

    mocks.listOllamaModels.mockResolvedValueOnce([]);
    await expect(
      runAdHocConverter("equation-to-latex", {
        text: "the square root of x",
        file: null,
      }),
    ).rejects.toThrow("Install a local Ollama model");
    expect(mocks.completeViaBackend).not.toHaveBeenCalled();
  });

  it("uses the first eligible local model when the configured model is unavailable", async () => {
    mocks.getConfig.mockResolvedValue({
      ai_keys: { ollama: "" },
      ai_provider: "openai",
      ai_model: "cloud-model",
    });
    mocks.listOllamaModels.mockResolvedValue(["qwen2.5vl:7b", "llava:7b"]);
    const image = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "notes.png",
    );
    await runAdHocConverter("image-to-latex", { text: "", file: image });
    expect(mocks.listOllamaModels).toHaveBeenCalledWith("http://127.0.0.1:11434");
    expect(mocks.completeViaBackend).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
      { provider_id: "ollama", model_id: "qwen2.5vl:7b" },
    );
  });

  it("rejects an empty local transcription", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "```latex\n\n```" });
    await expect(
      runAdHocConverter("equation-to-latex", {
        text: "the integral from zero to one",
        file: null,
      }),
    ).rejects.toThrow("empty transcription");
  });

  it("handles equation images and natural-language equations", async () => {
    const image = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "equation.png",
    );
    const progress = vi.fn();
    await runAdHocConverter("equation-to-latex", { text: "", file: image }, progress);
    expect(progress).toHaveBeenCalledWith({ step: "readingEquation" });
    expect(mocks.completeViaBackend).toHaveBeenLastCalledWith(
      expect.objectContaining({ system: expect.stringContaining("one LaTeX math expression") }),
      undefined,
      expect.any(Object),
    );

    await runAdHocConverter(
      "equation-to-latex",
      { text: "the square root of x", file: null },
      progress,
    );
    expect(progress).toHaveBeenCalledWith({ step: "convertingEquation" });
  });

  it("transcribes bounded scanned PDFs and inserts target-specific page breaks", async () => {
    await expect(transcribePdfPages(new Uint8Array(), 0, "LaTeX")).rejects.toThrow(
      "does not contain any pages",
    );
    await expect(transcribePdfPages(new Uint8Array(), 51, "LaTeX")).rejects.toThrow(
      "limited to 50 pages",
    );

    const progress = vi.fn();
    const bytes = new Uint8Array([1, 2, 3]);
    const markdown = await transcribePdfPages(bytes, 2, "Markdown", progress);
    expect(markdown).toBe("x^2\n\n---\n\nx^2");
    expect(progress).toHaveBeenLastCalledWith({ step: "transcribingPage", page: 2, total: 2 });
    expect(mocks.pdfPageToPng).toHaveBeenCalledWith(bytes, 2, 1.6, "#ffffff");

    const typst = await transcribePdfPages(bytes, 2, "Typst");
    expect(typst).toContain("#pagebreak()");
    const latex = await transcribePdfPages(bytes, 2, "LaTeX");
    expect(latex).toContain("\\documentclass{article}");
    expect(latex).toContain("\\newpage");
  });

  it("stops scanned-PDF transcription promptly when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcribePdfPages(new Uint8Array([1]), 1, "Markdown", undefined, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.pdfPageToPng).not.toHaveBeenCalled();
  });

  it.each([
    ["pdf-to-markdown", "markdown"],
    ["pdf-to-typst", "typst"],
  ] as const)("extracts a text-layer PDF through %s", async (id, target) => {
    mocks.extractPagesForConvert.mockResolvedValue({
      pages: [{}],
      figures: [{ name: "figure-1.png", pngDataUrl: "data:image/png;base64,AQID" }],
    });
    const progress = vi.fn();
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], "paper.pdf");
    const result = await runAdHocConverter(id, { text: "", file: pdf }, progress);
    expect(mocks.convertAdHoc).toHaveBeenCalledWith({
      source: "latex",
      target,
      text: expect.stringContaining("PDF text"),
    });
    expect(result.files).toEqual([
      { path: "assets/figure-1.png", dataBase64: "AQID" },
    ]);
    expect(result.note).toBe("Extracted 1 pages and 0 figures locally.");
    expect(progress.mock.calls.flat()).toEqual(
      expect.arrayContaining([{ step: "readingPages" }, { step: "documentStructure" }]),
    );
  });

  it("uses local OCR for a scanned PDF and preserves cancellation identity", async () => {
    mocks.convertPages.mockReturnValue({
      tex: "",
      report: { pages: 2, figures: 0, likelyScanned: true },
    });
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], "scan.pdf");
    const result = await runAdHocConverter("pdf-to-markdown", { text: "", file: pdf });
    expect(result.text).toContain("---");
    expect(result.note).toContain("Transcribed 2 scanned pages");

    const controller = new AbortController();
    controller.abort();
    await expect(
      runAdHocConverter("pdf-to-typst", { text: "", file: pdf }, undefined, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails clearly when Pandoc cannot be prepared", async () => {
    mocks.ensurePandoc.mockResolvedValue(false);
    await expect(
      runAdHocConverter("markdown-to-latex", { text: "source", file: null }),
    ).rejects.toThrow("Pandoc isn't ready yet");
  });

  it("extracts both online IDs and saved arXiv archives", async () => {
    mocks.extractArxivSource.mockResolvedValue({
      archiveName: "arxiv-paper",
      mainFile: "main.tex",
      mainSource: "\\documentclass{article}",
      files: [{ path: "main.tex", dataBase64: "WA==" }],
    });
    const progress = vi.fn();
    const online = await runAdHocConverter(
      "arxiv-to-latex",
      { text: " 2301.01234 ", file: null },
      progress,
    );
    expect(mocks.extractArxivSource).toHaveBeenCalledWith({
      arxivId: "2301.01234",
      dataBase64: undefined,
    });
    expect(online).toMatchObject({
      kind: "bundle",
      fileName: "arxiv-paper.zip",
      mainFile: "main.tex",
      note: "1 source files. Main document: main.tex.",
    });
    expect(progress).toHaveBeenCalledWith({ step: "downloadingSource" });

    const archive = new File([new Uint8Array([0x1f, 0x8b])], "paper.tar.gz");
    await runAdHocConverter("arxiv-to-latex", { text: "", file: archive }, progress);
    expect(mocks.extractArxivSource).toHaveBeenLastCalledWith({
      arxivId: undefined,
      dataBase64: "H4s=",
    });
    expect(progress).toHaveBeenCalledWith({ step: "unpackingSource" });
  });

  it("requires an arXiv ID or saved archive", async () => {
    await expect(
      runAdHocConverter("arxiv-to-latex", { text: " ", file: null }),
    ).rejects.toThrow("Enter an arXiv ID");
  });

  it("honors cancellation after the Mermaid renderer completes", async () => {
    const controller = new AbortController();
    mocks.renderDiagram.mockImplementation(async () => {
      controller.abort();
      return { outerHTML: "<svg />" };
    });
    await expect(
      runAdHocConverter(
        "mermaid-to-latex",
        { text: "sequenceDiagram\nA->>B: Hi", file: null },
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.svgDocumentToPngBytes).not.toHaveBeenCalled();
  });
});

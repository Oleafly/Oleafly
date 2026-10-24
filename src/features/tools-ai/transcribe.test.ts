import { beforeEach, describe, expect, it, vi } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  completeViaBackend: vi.fn(),
  convertAdHoc: vi.fn(),
  ensurePandoc: vi.fn(),
  mathpixText: vi.fn(),
  mathpixPdf: vi.fn(),
  pdfPageToPng: vi.fn(),
  downscaleImage: vi.fn(),
  resolveToolsModel: vi.fn(),
}));

vi.mock("@/lib/agent-backend", () => ({ completeViaBackend: mocks.completeViaBackend }));
vi.mock("@/lib/tauri", () => ({
  convertAdHoc: mocks.convertAdHoc,
  getConfig: vi.fn(),
  setConfig: vi.fn(),
}));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));
vi.mock("@/lib/mathpix", () => ({
  mathpixText: mocks.mathpixText,
  mathpixPdf: mocks.mathpixPdf,
  mathpixKeyStatus: vi.fn(),
}));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: mocks.pdfPageToPng }));
vi.mock("./image-downscale", () => ({ downscaleImage: mocks.downscaleImage }));
vi.mock("./tools-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tools-model")>()),
  resolveToolsModel: mocks.resolveToolsModel,
}));

import { IMAGE_BUDGETS, type ImageInput } from "./image-input";
import { ocrProfileFor } from "./ocr-profiles";
import { toolsMaxTokens, ToolsModelError, type ResolvedLlm, type ResolvedMathpix } from "./tools-model";
import {
  modelInfo,
  transcribeEditorImage,
  transcribeEquationText,
  transcribeImage,
  transcribePdfPages,
} from "./transcribe";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG: ImageInput = { bytes: PNG_BYTES, mime: "image/png" };
const JPEG: ImageInput = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mime: "image/jpeg" };

function llm(overrides: Partial<ResolvedLlm> = {}): ResolvedLlm {
  return {
    engine: "llm",
    providerId: "ollama",
    modelId: "llava",
    label: "llava",
    hosted: false,
    destination: { kind: "device" },
    profile: null,
    ...overrides,
  };
}

const glmOcr = llm({ modelId: "glm-ocr", label: "glm-ocr", profile: ocrProfileFor("glm-ocr") });
const deepseekOcr = llm({ modelId: "deepseek-ocr", label: "deepseek-ocr", profile: ocrProfileFor("deepseek-ocr") });
const claude = llm({
  providerId: "anthropic",
  modelId: "claude-opus-5-5",
  label: "Claude Opus 5.5",
  hosted: true,
  destination: { kind: "provider", providerId: "anthropic", name: "Anthropic" },
});
const mathpix: ResolvedMathpix = {
  engine: "mathpix",
  label: "Mathpix",
  hosted: true,
  destination: { kind: "provider", providerId: "mathpix", name: "Mathpix" },
};

interface SentRequest {
  system?: string;
  messages: { content: { type: string; text?: string; image?: string }[] }[];
  temperature?: number;
  max_tokens?: number;
  effort?: string;
  reasoning_summary?: boolean;
}

function sent(call = 0): SentRequest {
  return mocks.completeViaBackend.mock.calls[call][0] as SentRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.completeViaBackend.mockResolvedValue({ text: "x" });
  mocks.ensurePandoc.mockResolvedValue(true);
  mocks.convertAdHoc.mockResolvedValue({ text: "converted\n" });
  mocks.downscaleImage.mockResolvedValue(JPEG);
  mocks.pdfPageToPng.mockResolvedValue("data:image/png;base64,iVBORw0KGgo=");
  mocks.resolveToolsModel.mockResolvedValue(llm());
});

describe("image transcription", () => {
  it("sends a generic vision model the image first, then the target prompt", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "```latex\n\\section{A}\n```" });
    const model = llm();
    await expect(
      transcribeImage(model, PNG, { target: "LaTeX", mode: "image", fragment: true }),
    ).resolves.toBe("\\section{A}");
    const request = sent();
    expect(request.messages[0].content[0].type).toBe("image");
    expect(request.messages[0].content[0].image).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(request.messages[0].content[1].text).toBe("Transcribe this image into LaTeX.");
    expect(request.system).toContain("Return only LaTeX source");
    expect(request.temperature).toBe(0);
    expect(request.max_tokens).toBe(toolsMaxTokens(model));
    expect(mocks.completeViaBackend.mock.calls[0][2]).toEqual({ provider_id: "ollama", model_id: "llava" });
    expect(mocks.convertAdHoc).not.toHaveBeenCalled();
  });

  it("asks for no thinking: a transcription copies the page", async () => {
    await transcribeImage(claude, PNG, { target: "LaTeX", mode: "image", fragment: true });
    await transcribeEquationText(claude, "x squared", undefined);
    for (const call of [0, 1]) {
      expect(sent(call).effort).toBe("none");
      expect(sent(call).reasoning_summary).toBe(false);
    }
    await transcribePdfPages(new Uint8Array([1]), [1], "Markdown");
    expect(sent(2).effort).toBe("none");
  });

  it("fails a reply that stopped at the output limit instead of passing on half a page", async () => {
    for (const stop of ["max_tokens", "length", "max_output_tokens"]) {
      mocks.completeViaBackend.mockResolvedValue({ text: "\\begin{tabular}{ll} a & b", stop_reason: stop });
      await expect(
        transcribeImage(claude, PNG, { target: "LaTeX", mode: "image", fragment: true }),
      ).rejects.toMatchObject({
        name: "ToolsModelError",
        message: researchTools.converterErrors.outputLimit,
      });
    }
    // A scanned page that is cut off stops the run before the next page.
    mocks.completeViaBackend.mockClear();
    mocks.completeViaBackend.mockResolvedValue({ text: "half", stop_reason: "max_tokens" });
    await expect(transcribePdfPages(new Uint8Array([1]), [1, 2, 3], "Markdown")).rejects.toThrow(
      researchTools.converterErrors.outputLimit,
    );
    expect(mocks.completeViaBackend).toHaveBeenCalledOnce();
    // Other reasons, and none at all, are fine.
    mocks.completeViaBackend.mockResolvedValue({ text: "ok", stop_reason: "end_turn" });
    await expect(
      transcribeImage(claude, PNG, { target: "Typst", mode: "image", fragment: true }),
    ).resolves.toBe("ok");
  });

  it("downscales for hosted models and keeps originals for Ollama", async () => {
    await transcribeImage(llm(), PNG, { target: "Typst", mode: "image", fragment: true });
    expect(mocks.downscaleImage).not.toHaveBeenCalled();
    await transcribeImage(claude, PNG, { target: "Typst", mode: "image", fragment: true });
    expect(mocks.downscaleImage).toHaveBeenCalledWith(PNG, IMAGE_BUDGETS.hosted);
    expect(sent(1).messages[0].content[0].image).toBe("data:image/jpeg;base64,/9j/4A==");
    expect(sent(1).max_tokens).toBe(8192);
    expect(mocks.completeViaBackend.mock.calls[1][2]).toEqual({
      provider_id: "anthropic",
      model_id: "claude-opus-5-5",
    });
  });

  it("gives glm-ocr its own prompt, no system prompt, and converts its Markdown as a fragment", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "```markdown\n# Title\r\n\r\nText \\(x\\)\n```" });
    mocks.convertAdHoc.mockResolvedValue({ text: "\\section{Title}\n" });
    await expect(
      transcribeImage(glmOcr, PNG, { target: "LaTeX", mode: "image", fragment: true }),
    ).resolves.toBe("\\section{Title}");
    const request = sent();
    expect(request).not.toHaveProperty("system");
    expect(request.messages[0].content[1].text).toBe("Text Recognition:");
    expect(mocks.convertAdHoc).toHaveBeenCalledWith({
      source: "ocr-fragment",
      target: "latex",
      text: "# Title\n\nText \\(x\\)",
    });
    expect(mocks.ensurePandoc).toHaveBeenCalledWith({ notify: true });
  });

  it("strips DeepSeek grounding before Pandoc", async () => {
    mocks.completeViaBackend.mockResolvedValue({
      text: "<|ref|>title<|/ref|><|det|>[[1, 2, 3, 4]]<|/det|>\n# Results\n\n<table><tr><td>1</td></tr></table>",
    });
    await transcribeImage(deepseekOcr, PNG, { target: "Typst", mode: "image", fragment: false });
    expect(sent().messages[0].content[1].text).toBe("<|grounding|>Convert the document to markdown.");
    const [{ source, target, text }] = mocks.convertAdHoc.mock.calls[0] as [{ source: string; target: string; text: string }];
    expect([source, target]).toEqual(["ocr-markdown", "typst"]);
    expect(text).toBe("# Results\n\n<table><tr><td>1</td></tr></table>");
    expect(text).not.toContain("<|");
  });

  it("returns bare LaTeX for an equation image read by an OCR model", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "$$x^2$$" });
    await expect(
      transcribeImage(glmOcr, PNG, { target: "LaTeX", mode: "equation", fragment: true }),
    ).resolves.toBe("x^2");
    expect(sent().messages[0].content[1].text).toBe("Formula Recognition:");
    expect(mocks.convertAdHoc).not.toHaveBeenCalled();
  });

  it("asks a generic model for one expression in equation mode", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "\\[ \\frac{a}{b} \\]" });
    await expect(
      transcribeImage(llm(), PNG, { target: "LaTeX", mode: "equation", fragment: true }),
    ).resolves.toBe("\\frac{a}{b}");
    expect(sent().system).toContain("one LaTeX math expression");
  });

  it("uses Mathpix latex_styled for a single equation", async () => {
    mocks.mathpixText.mockResolvedValue({ text: "\\[x\\]", latexStyled: "x", confidence: 0.9 });
    await expect(
      transcribeImage(mathpix, PNG, { target: "LaTeX", mode: "image", fragment: true }),
    ).resolves.toBe("\\[\nx\n\\]");
    expect(mocks.downscaleImage).toHaveBeenCalledWith(PNG, IMAGE_BUDGETS.mathpix);
    expect(mocks.mathpixText).toHaveBeenCalledWith("/9j/4A==", "image/jpeg");
    await expect(
      transcribeImage(mathpix, PNG, { target: "Typst", mode: "image", fragment: true }),
    ).resolves.toBe("$ x $");
    await expect(
      transcribeImage(mathpix, PNG, { target: "Markdown", mode: "image", fragment: true }),
    ).resolves.toBe("$$\nx\n$$");
    await expect(
      transcribeImage(mathpix, PNG, { target: "LaTeX", mode: "equation", fragment: true }),
    ).resolves.toBe("x");
    expect(mocks.completeViaBackend).not.toHaveBeenCalled();
  });

  it("sends Mathpix Markdown through Pandoc when the image is more than one equation", async () => {
    mocks.mathpixText.mockResolvedValue({
      text: "Intro \\(x\\)\r\n<table><tr><td>1</td></tr></table>\r\n![](https://cdn.mathpix.com/c.jpg)",
      latexStyled: null,
      confidence: 0.7,
    });
    mocks.convertAdHoc.mockResolvedValue({ text: "Intro $x$\n" });
    await expect(
      transcribeImage(mathpix, PNG, { target: "Typst", mode: "image", fragment: true }),
    ).resolves.toBe("Intro $x$");
    expect(mocks.convertAdHoc).toHaveBeenCalledWith({
      source: "ocr-fragment",
      target: "typst",
      text: "Intro \\(x\\)\n\n<table><tr><td>1</td></tr></table>",
    });
  });

  it("needs a language model for typed equations", async () => {
    await expect(transcribeEquationText(mathpix, "x squared")).rejects.toBeInstanceOf(ToolsModelError);
    await expect(transcribeEquationText(glmOcr, "x squared")).rejects.toThrow(
      researchTools.converterModel.errors.imagesOnly.replace("{{model}}", "glm-ocr"),
    );
    expect(mocks.completeViaBackend).not.toHaveBeenCalled();
    mocks.completeViaBackend.mockResolvedValue({ text: "$x^2$" });
    await expect(transcribeEquationText(llm(), "x squared")).resolves.toBe("x^2");
    expect(sent().messages[0].content).toEqual([
      { type: "text", text: "Convert this equation into LaTeX:\n\nx squared" },
    ]);
  });

  it("treats an empty reply as an error", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "```latex\n\n```" });
    const empty = transcribeImage(llm(), PNG, { target: "LaTeX", mode: "image", fragment: true });
    await expect(empty).rejects.toBeInstanceOf(ToolsModelError);
    await expect(empty).rejects.toThrow(researchTools.converterErrors.emptyTranscription);
  });

  it("stops before asking the model when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcribeImage(llm(), PNG, { target: "LaTeX", mode: "image", fragment: true, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.completeViaBackend).not.toHaveBeenCalled();
  });
});

describe("scanned PDF transcription", () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);

  it("rejects zero and 51 pages before rendering anything", async () => {
    await expect(transcribePdfPages(bytes, [], "LaTeX")).rejects.toThrow(researchTools.converterErrors.pdfNoPages);
    const tooMany = Array.from({ length: 51 }, (_, index) => index + 1);
    await expect(transcribePdfPages(bytes, tooMany, "LaTeX")).rejects.toThrow(
      researchTools.converterErrors.pdfPageLimit,
    );
    expect(mocks.pdfPageToPng).not.toHaveBeenCalled();
    expect(mocks.resolveToolsModel).not.toHaveBeenCalled();
  });

  it("joins OCR pages with raw breaks and converts the document once", async () => {
    mocks.resolveToolsModel.mockResolvedValue(deepseekOcr);
    mocks.completeViaBackend.mockResolvedValueOnce({ text: "Page A" }).mockResolvedValueOnce({ text: "Page B" });
    const progress = vi.fn();
    const result = await transcribePdfPages(bytes, [1, 2], "LaTeX", progress);
    expect(mocks.convertAdHoc).toHaveBeenCalledOnce();
    expect(mocks.convertAdHoc).toHaveBeenCalledWith({
      source: "ocr-markdown",
      target: "latex",
      text: "Page A\n\n```{=latex}\n\\newpage\n```\n\nPage B",
    });
    expect(result).toEqual({ text: "converted", model: { label: "deepseek-ocr", sentTo: null } });
    expect(progress).toHaveBeenLastCalledWith({ step: "formattingTranscription", model: "deepseek-ocr" });
    expect(mocks.pdfPageToPng).toHaveBeenCalledWith(bytes, 2, 1.6, "#ffffff");
  });

  it("keeps the generic per-page LaTeX wrapper and page breaks for other models", async () => {
    const latex = await transcribePdfPages(bytes, [1, 2], "LaTeX");
    expect(latex.text).toContain("\\documentclass{article}");
    expect(latex.text).toContain("x\n\n\\newpage\n\nx");
    expect((await transcribePdfPages(bytes, [1, 2], "Typst")).text).toBe("x\n\n#pagebreak()\n\nx");
    expect((await transcribePdfPages(bytes, [1, 2], "Markdown")).text).toBe("x\n\n---\n\nx");
    expect(mocks.convertAdHoc).not.toHaveBeenCalled();
  });

  it("uploads a scanned PDF to Mathpix once with its page range", async () => {
    mocks.resolveToolsModel.mockResolvedValue(mathpix);
    mocks.mathpixPdf.mockImplementation(
      async (_bytes: Uint8Array, options: { onProgress?: (progress: unknown) => void }) => {
        options.onProgress?.({ status: "split", pagesDone: 1, pagesTotal: 3 });
        return "P1\n\\pagebreak\nP2";
      },
    );
    const progress = vi.fn();
    const result = await transcribePdfPages(bytes, [3, 4, 5], "LaTeX", progress);
    expect(mocks.mathpixPdf).toHaveBeenCalledOnce();
    expect(mocks.mathpixPdf).toHaveBeenCalledWith(bytes, expect.objectContaining({ pageRanges: "3-5" }));
    expect(progress.mock.calls.map(([event]) => event)).toEqual([
      { step: "uploadingPdf", model: "Mathpix" },
      { step: "transcribingPage", page: 1, total: 3, model: "Mathpix" },
      { step: "formattingTranscription", model: "Mathpix" },
    ]);
    expect(mocks.convertAdHoc).toHaveBeenCalledWith({
      source: "ocr-markdown",
      target: "latex",
      text: "P1\n\n```{=latex}\n\\newpage\n```\n\nP2",
    });
    expect(mocks.pdfPageToPng).not.toHaveBeenCalled();
    expect(result.model).toEqual({ label: "Mathpix", sentTo: "Mathpix" });
  });

  it("sends Mathpix every page run as compact ranges", async () => {
    mocks.resolveToolsModel.mockResolvedValue(mathpix);
    mocks.mathpixPdf.mockResolvedValue("P");
    await transcribePdfPages(bytes, [7], "Markdown");
    await transcribePdfPages(bytes, [1, 2, 4, 6, 7], "Markdown");
    expect(mocks.mathpixPdf.mock.calls.map(([, options]) => (options as { pageRanges: string }).pageRanges)).toEqual([
      "7",
      "1-2,4,6-7",
    ]);
  });

  it("reports page, total and model, and stops before the next page when cancelled", async () => {
    const controller = new AbortController();
    mocks.completeViaBackend.mockImplementationOnce(async () => {
      controller.abort();
      return { text: "first" };
    });
    const progress = vi.fn();
    await expect(
      transcribePdfPages(bytes, [4, 5], "Markdown", progress, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(progress).toHaveBeenCalledWith({ step: "transcribingPage", page: 1, total: 2, model: "llava" });
    expect(mocks.pdfPageToPng).toHaveBeenCalledOnce();
    expect(mocks.pdfPageToPng).toHaveBeenCalledWith(bytes, 4, 1.6, "#ffffff");
  });

  it("returns the model label and where the pages went", async () => {
    mocks.resolveToolsModel.mockResolvedValue(claude);
    const result = await transcribePdfPages(bytes, [1], "Markdown");
    expect(result.model).toEqual({ label: "Claude Opus 5.5", sentTo: "Anthropic" });
    expect(modelInfo(llm({ destination: { kind: "host", host: "192.168.1.9:11434" } }))).toEqual({
      label: "llava",
      sentTo: "Ollama (192.168.1.9:11434)",
    });
  });

  it("fails when every page came back empty", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "  " });
    await expect(transcribePdfPages(bytes, [1, 2], "Markdown")).rejects.toThrow(
      researchTools.converterErrors.emptyTranscription,
    );
  });
});

describe("editor transcription", () => {
  it("transcribes an editor image with the Tools model and tells the caller which model runs", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "$ E = m c^2 $" });
    const onModel = vi.fn();
    const file = new File([PNG_BYTES], "equation.png", { type: "image/png" });
    await expect(transcribeEditorImage(file, "Typst", { onModel, typstVersion: "0.13.1" })).resolves.toBe(
      "$ E = m c^2 $",
    );
    // The editor alone may fall back to the assistant's model (0.4.7 used it).
    expect(mocks.resolveToolsModel).toHaveBeenCalledWith("image", { assistantFallback: true });
    expect(onModel).toHaveBeenCalledWith(llm());
    expect(sent().system).toContain("Return only Typst source");
    expect(sent().messages[0].content[1].text).toBe("Transcribe this image into Typst.");
  });

  it("draws a GIF from the editor again as PNG before a model reads it", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "x^2" });
    mocks.downscaleImage.mockResolvedValue(PNG);
    const gif = new File([new TextEncoder().encode("GIF89a......")], "board.gif", { type: "image/gif" });
    await expect(transcribeEditorImage(gif, "LaTeX")).resolves.toBe("x^2");
    expect(mocks.downscaleImage).toHaveBeenCalledWith(
      expect.objectContaining({ mime: "image/gif" }),
      expect.objectContaining({ accept: ["image/png"] }),
    );
    expect(sent().messages[0].content[0].image).toMatch(/^data:image\/png;base64,/);
  });

  it("refuses a file that is not an image before choosing a model", async () => {
    const file = new File([new TextEncoder().encode("not an image")], "notes.png");
    await expect(transcribeEditorImage(file, "LaTeX")).rejects.toThrow(researchTools.converterErrors.imageFormat);
    expect(mocks.resolveToolsModel).not.toHaveBeenCalled();
  });
});

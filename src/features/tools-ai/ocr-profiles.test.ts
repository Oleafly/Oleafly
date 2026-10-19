import { describe, expect, it } from "vitest";
import {
  cleanOcrReply,
  extractSingleMath,
  joinOcrPages,
  mathpixToOcrMarkdown,
  normalizeOcrMarkdown,
  ocrProfileFor,
  pageBreakBlock,
} from "./ocr-profiles";

describe("OCR model profiles", () => {
  it.each([
    ["glm-ocr", "glm-ocr"],
    ["glm-ocr:latest", "glm-ocr"],
    ["hf.co/zai-org/GLM-OCR-GGUF:Q8_0", "glm-ocr"],
    ["deepseek-ocr:3b", "deepseek-ocr"],
    ["dots.ocr", "dots-ocr"],
    ["rednote-hilab/dots.ocr", "dots-ocr"],
    ["dots.mocr", "dots-ocr"],
    ["llava", null],
    ["glm-4.5v", null],
    ["qwen2.5vl:7b", null],
    ["my-glm-ocr", null],
  ])("ocrProfileFor(%s)", (model, profile) => {
    expect(ocrProfileFor(model)?.id ?? null).toBe(profile);
  });

  it("uses each model's documented prompt", () => {
    expect(ocrProfileFor("glm-ocr")).toMatchObject({
      pagePrompt: "Text Recognition:",
      formulaPrompt: "Formula Recognition:",
    });
    expect(ocrProfileFor("deepseek-ocr")?.pagePrompt).toBe("<|grounding|>Convert the document to markdown.");
    expect(ocrProfileFor("deepseek-ocr")?.formulaPrompt).toBe("<|grounding|>Convert the document to markdown.");
    expect(ocrProfileFor("dots.ocr")?.pagePrompt).toBe("Extract the text content from this image.");
  });

  it("strips DeepSeek grounding tags and code fences", () => {
    const reply =
      "```markdown\n<|ref|>title<|/ref|><|det|>[[10, 20, 300, 40]]<|/det|>\n# Results\r\n\r\n<|ref|>image<|/ref|><|det|>[[0,0,5,5]]<|/det|>\n\\(x^2\\)\n```";
    expect(cleanOcrReply(reply, ocrProfileFor("deepseek-ocr"))).toBe("# Results\n\n\\(x^2\\)");
  });

  it("keeps other replies' angle-bar text and collapses blank lines", () => {
    expect(cleanOcrReply("A\n\n\n\nB<|ref|>", null)).toBe("A\n\nB<|ref|>");
    expect(cleanOcrReply("```latex\n\n```", null)).toBe("");
    expect(cleanOcrReply("```\n```", ocrProfileFor("glm-ocr"))).toBe("");
  });

  it.each([
    ["$$x^2$$", "x^2"],
    ["\\[ a+b \\]", "a+b"],
    ["\\(a\\)", "a"],
    ["$a$", "a"],
    ["\\begin{equation}E=mc^2\\end{equation}", "E=mc^2"],
    ["\\begin{equation*}E=mc^2\\end{equation*}", "E=mc^2"],
    ["$$\n\\frac{1}{2}\n$$", "\\frac{1}{2}"],
    ["\\begin{align}a&=b\\end{align}", "\\begin{align}a&=b\\end{align}"],
    ["x^2", "x^2"],
    ["$$a$$ and $$b$$", "$$a$$ and $$b$$"],
    ["```latex\n$$y$$\n```", "y"],
  ])("extractSingleMath(%s)", (reply, latex) => {
    expect(extractSingleMath(reply)).toBe(latex);
  });

  it("isolates HTML tables, drops remote images and CRLF", () => {
    expect(
      normalizeOcrMarkdown(
        "Intro<table><tr><td>$x$</td></tr></table>tail\r\n![](https://cdn.mathpix.com/cropped/a.jpg)\r\n\\includegraphics[width=2in]{https://cdn.mathpix.com/b.png}",
      ),
    ).toBe("Intro\n\n<table><tr><td>$x$</td></tr></table>\n\ntail");
  });

  it("joins pages with a raw page break for each target", () => {
    expect(joinOcrPages(["A", "B"], "LaTeX")).toBe("A\n\n```{=latex}\n\\newpage\n```\n\nB");
    expect(joinOcrPages(["A", "B"], "Typst")).toBe("A\n\n```{=typst}\n#pagebreak()\n```\n\nB");
    expect(joinOcrPages(["A", "B"], "Markdown")).toBe("A\n\n---\n\nB");
    expect(pageBreakBlock("Markdown")).toBe("---");
  });

  it("maps Mathpix page breaks, CRLF included", () => {
    expect(mathpixToOcrMarkdown("P1\r\n\\pagebreak\r\nP2", "Typst")).toBe(
      "P1\n\n```{=typst}\n#pagebreak()\n```\n\nP2",
    );
    expect(mathpixToOcrMarkdown("\\pagebreak\nOnly page\n\\pagebreak\n", "LaTeX")).toBe("Only page");
    expect(mathpixToOcrMarkdown("P1 ![](https://cdn.mathpix.com/x.jpg)", "Markdown")).toBe("P1");
  });
});

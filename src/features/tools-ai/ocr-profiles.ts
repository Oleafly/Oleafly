// OCR models (glm-ocr, deepseek-ocr, dots.ocr) read a page better with the
// prompt they were trained on, and answer in Markdown that the bundled Pandoc
// turns into LaTeX, Typst or Markdown. Pure and small: the editor toolbar
// loads it on startup.

export type OcrProfileId = "glm-ocr" | "deepseek-ocr" | "dots-ocr";

export interface OcrProfile {
  id: OcrProfileId;
  pagePrompt: string;
  formulaPrompt: string;
}

export type OcrTarget = "LaTeX" | "Typst" | "Markdown";

const DEEPSEEK_PROMPT = "<|grounding|>Convert the document to markdown.";
const DOTS_PROMPT = "Extract the text content from this image.";

const PROFILES: Readonly<Record<OcrProfileId, OcrProfile>> = {
  "glm-ocr": {
    id: "glm-ocr",
    pagePrompt: "Text Recognition:",
    formulaPrompt: "Formula Recognition:",
  },
  "deepseek-ocr": { id: "deepseek-ocr", pagePrompt: DEEPSEEK_PROMPT, formulaPrompt: DEEPSEEK_PROMPT },
  "dots-ocr": { id: "dots-ocr", pagePrompt: DOTS_PROMPT, formulaPrompt: DOTS_PROMPT },
};

const MATCHERS: readonly (readonly [RegExp, OcrProfileId])[] = [
  // GLM's GGUF repository is glm-ocr-gguf, so a word boundary, not the end.
  [/^glm-?ocr\b/, "glm-ocr"],
  [/^deepseek-?ocr\b/, "deepseek-ocr"],
  [/^dots[._-]?m?ocr\b/, "dots-ocr"],
];

export function ocrProfileFor(modelId: string): OcrProfile | null {
  const lastSegment = modelId.trim().toLowerCase().split("/").pop() ?? "";
  const name = lastSegment.split(":")[0] ?? "";
  for (const [pattern, id] of MATCHERS) {
    if (pattern.test(name)) return PROFILES[id];
  }
  return null;
}

/** A model reply without code fences, DeepSeek grounding tags, CRLF and
 * extra blank lines. */
export function cleanOcrReply(reply: string, profile: OcrProfile | null): string {
  let text = reply
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*```[^\n]*\n/, "")
    .replace(/\n?```\s*$/, "");
  if (profile?.id === "deepseek-ocr") {
    text = text
      .replace(/<\|ref\|>[\s\S]*?<\|\/ref\|>\s*<\|det\|>[\s\S]*?<\|\/det\|>\s*/g, "")
      .replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, "")
      .replace(/<\|\/?(?:ref|grounding)\|>/g, "");
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

const SINGLE_MATH: readonly RegExp[] = [
  /^\$\$((?:(?!\$\$)[\s\S])+)\$\$$/,
  /^\\\[((?:(?!\\\])[\s\S])+)\\\]$/,
  /^\\\(((?:(?!\\\))[\s\S])+)\\\)$/,
  /^\$([^$]+)\$$/,
];

const SINGLE_ENVIRONMENT =
  /^\\begin\{(equation\*?|displaymath)\}((?:(?!\\end\{(?:equation\*?|displaymath)\})[\s\S])+)\\end\{\1\}$/;

export function extractSingleMath(reply: string): string {
  const text = cleanOcrReply(reply, null);
  for (const pattern of SINGLE_MATH) {
    const match = pattern.exec(text);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  const environment = SINGLE_ENVIRONMENT.exec(text);
  if (environment?.[2]?.trim()) return environment[2].trim();
  return text;
}

/** OCR Markdown ready for Pandoc: LF line ends, no remote images (Pandoc
 * would not fetch them and LaTeX could not compile them), and HTML tables
 * on their own lines so they read as HTML blocks. */
export function normalizeOcrMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/!\[[^\]]*\]\(\s*https?:\/\/[^)]*\)/g, "")
    .replace(/\\includegraphics(?:\[[^\]]*\])?\{\s*https?:\/\/[^}]*\}/g, "")
    .replace(/<table\b[\s\S]*?<\/table>/gi, (table) => `\n\n${table}\n\n`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A page break Pandoc passes straight to the target format. */
export function pageBreakBlock(target: OcrTarget): string {
  switch (target) {
    case "LaTeX":
      return "```{=latex}\n\\newpage\n```";
    case "Typst":
      return "```{=typst}\n#pagebreak()\n```";
    case "Markdown":
      return "---";
  }
}

export function joinOcrPages(pages: readonly string[], target: OcrTarget): string {
  return pages.join(`\n\n${pageBreakBlock(target)}\n\n`);
}

/** Mathpix Markdown of a PDF as OCR Markdown: its `\pagebreak` lines become
 * the target's page breaks. */
export function mathpixToOcrMarkdown(mmd: string, target: OcrTarget): string {
  const pages: string[][] = [[]];
  for (const line of mmd.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === String.raw`\pagebreak`) pages.push([]);
    else pages.at(-1)?.push(line);
  }
  return joinOcrPages(
    pages.map((lines) => normalizeOcrMarkdown(lines.join("\n"))).filter(Boolean),
    target,
  );
}

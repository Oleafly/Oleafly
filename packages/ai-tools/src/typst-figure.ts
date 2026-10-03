export interface TypstFigureDiagnostic {
  severity: "error" | "warning";
  message: string;
  line: number | null;
  column: number | null;
}

export type TypstFigureRender =
  | { ok: true; pngBase64: string; diagnostics: TypstFigureDiagnostic[] }
  | { ok: false; diagnostics: TypstFigureDiagnostic[] };

export interface TypstPreviewResult {
  success: boolean;
  has_image: boolean;
  errors: TypstFigureDiagnostic[];
  warnings: TypstFigureDiagnostic[];
}

const PREVIEW_PAGE = "#set page(fill: white, margin: 6pt)\n";
const PREVIEW_PAGE_LINES = 1;
const INVALID_LABEL_CHARS = /[^\p{L}\p{N}_\-.:]+/gu;

export function typstPreviewSource(code: string): string {
  return `${PREVIEW_PAGE}${code}`;
}

function codeDiagnostic(diagnostic: TypstFigureDiagnostic): TypstFigureDiagnostic {
  const line =
    diagnostic.line !== null && diagnostic.line > PREVIEW_PAGE_LINES
      ? diagnostic.line - PREVIEW_PAGE_LINES
      : null;
  return { ...diagnostic, line, column: line === null ? null : diagnostic.column };
}

export function typstPreviewOutcome(render: TypstFigureRender): {
  pngDataUrl: string | null;
  result: TypstPreviewResult;
} {
  const diagnostics = render.diagnostics.map(codeDiagnostic);
  return {
    pngDataUrl: render.ok ? `data:image/png;base64,${render.pngBase64}` : null,
    result: {
      success: render.ok,
      has_image: render.ok,
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning"),
    },
  };
}

function stripLeading(text: string, char: string): string {
  let start = 0;
  while (start < text.length && text[start] === char) start += 1;
  return text.slice(start);
}

function stripTrailing(text: string, char: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) end -= 1;
  return text.slice(0, end);
}

export function typstLabel(label: string): string | null {
  const bare = stripTrailing(stripLeading(label.trim(), "<"), ">");
  const cleaned = stripTrailing(stripLeading(bare.replaceAll(INVALID_LABEL_CHARS, "-"), "-"), "-");
  return cleaned || null;
}

function balanced(line: string): boolean {
  let depth = 0;
  for (const char of line) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
  }
  return depth === 0;
}

function isImportLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("#import ") && balanced(trimmed);
}

function splitLeadingImports(code: string): { imports: string[]; body: string } {
  const lines = code.trim().split(/\r?\n/);
  const imports: string[] = [];
  let index = 0;
  while (index < lines.length && (lines[index].trim() === "" || isImportLine(lines[index]))) {
    if (lines[index].trim()) imports.push(lines[index].trim());
    index += 1;
  }
  return { imports, body: lines.slice(index).join("\n").trim() };
}

function indented(body: string): string {
  return body
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : ""))
    .join("\n");
}

export function typstFigureMarkup(
  code: string,
  options: { caption?: string; label?: string; raw?: boolean; existingSource?: string },
): string {
  const { imports, body } = splitLeadingImports(code);
  const existing = new Set(
    (options.existingSource ?? "").split(/\r?\n/).map((line) => line.trim()),
  );
  const head = imports.filter((line) => !existing.has(line));
  const prefix = head.length ? `${head.join("\n")}\n` : "";
  if (options.raw) return `${prefix}${body}`;
  const caption = options.caption?.trim();
  const label = options.label ? typstLabel(options.label) : null;
  const args = caption ? `(caption: [${caption}])` : "";
  const suffix = label ? ` <${label}>` : "";
  return `${prefix}#figure${args}[\n${indented(body)}\n]${suffix}`;
}

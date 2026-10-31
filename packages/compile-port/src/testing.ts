import type { DocumentEngineId } from "@oleafly/backend-port";
import { gzipSync, strToU8 } from "fflate";
import type { BrowserEngine, CompileSources, EngineResult } from "./browser";
import { CompileStopped } from "./port";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const FONT_SIZE = 11;
const LEADING = 16;
const ASCENT = 8;
const DESCENT = 3;
const ADVANCE = FONT_SIZE / 2;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING);
const MAX_CHARS = Math.floor((PAGE_WIDTH - 2 * MARGIN) / ADVANCE);
const SP_PER_BP = 65781.76;
const MAX_INPUT_DEPTH = 4;
const ERROR_COMMAND = String.raw`\fakeerror`;

interface TypesetLine {
  tag: number;
  line: number;
  text: string;
}

interface Failure {
  path: string;
  line: number;
  text: string;
}

interface Collected {
  inputs: string[];
  lines: TypesetLine[];
  failures: Failure[];
}

export interface FakeEngineOptions {
  engines?: readonly DocumentEngineId[];
  delayMs?: number;
}

function resolveInput(sources: CompileSources, name: string): string | null {
  const texts = new Set(sources.files.filter((file) => file.kind === "text").map((file) => file.path));
  const clean = name.trim().replace(/^\.\//u, "");
  return [clean, `${clean}.tex`].find((candidate) => texts.has(candidate)) ?? null;
}

function collect(sources: CompileSources, path: string, depth: number, into: Collected): boolean {
  const text = sources.text(path);
  if (text === null) return false;
  into.inputs.push(path);
  const tag = into.inputs.length;
  const hasBody = depth === 0 && /\\begin\{document\}/u.test(text);
  let inBody = !hasBody;
  text.split(/\r\n|\n|\r/u).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (hasBody && trimmed.includes(String.raw`\begin{document}`)) {
      inBody = true;
      return;
    }
    if (trimmed.includes(String.raw`\end{document}`)) {
      inBody = false;
      return;
    }
    if (!inBody || trimmed === "" || trimmed.startsWith("%")) return;
    if (trimmed.includes(ERROR_COMMAND)) into.failures.push({ path, line, text: trimmed });
    const input = /^\\(?:input|include)\{([^}]+)\}$/u.exec(trimmed);
    const child = input && depth < MAX_INPUT_DEPTH ? resolveInput(sources, input[1]) : null;
    if (child && collect(sources, child, depth + 1, into)) return;
    into.lines.push({ tag, line, text: trimmed.slice(0, MAX_CHARS) });
  });
  return true;
}

function pdfText(value: string): string {
  return value.replace(/[\\()]/gu, (match) => `\\${match}`).replace(/[^\x20-\x7e]/gu, "?");
}

function baseline(slot: number): number {
  return MARGIN + ASCENT + slot * LEADING;
}

function paginate(lines: readonly TypesetLine[]): TypesetLine[][] {
  const pages: TypesetLine[][] = [];
  for (let start = 0; start < lines.length; start += LINES_PER_PAGE) {
    pages.push(lines.slice(start, start + LINES_PER_PAGE));
  }
  return pages.length > 0 ? pages : [[]];
}

function fakePdf(pages: readonly (readonly TypesetLine[])[]): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const kids: string[] = [];
  for (const page of pages) {
    const content = page
      .map(
        (line, slot) =>
          `BT /F1 ${FONT_SIZE} Tf ${MARGIN} ${PAGE_HEIGHT - baseline(slot)} Td (${pdfText(line.text)}) Tj ET`,
      )
      .join("\n");
    const pageNumber = objects.length + 1;
    kids.push(`${pageNumber} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${pageNumber + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(body);
}

function sp(bp: number): number {
  return Math.round(bp * SP_PER_BP);
}

/** SyncTeX text for the pages: one horizontal box per line with a glue record after each word. */
function fakeSyncTex(inputs: readonly string[], pages: readonly (readonly TypesetLine[])[]): string {
  const out = ["SyncTeX Version:1"];
  inputs.forEach((path, index) => out.push(`Input:${index + 1}:${path}`));
  out.push("Output:pdf", "Magnification:1000", "Unit:1", "X Offset:0", "Y Offset:0", "Content:");
  pages.forEach((page, index) => {
    const number = index + 1;
    out.push(`{${number}`, `[0,0:0,0:${sp(PAGE_WIDTH)},${sp(PAGE_HEIGHT)},0`);
    page.forEach((line, slot) => {
      const v = sp(baseline(slot));
      const width = Math.max(5, line.text.length * ADVANCE);
      out.push(`(${line.tag},${line.line}:${sp(MARGIN)},${v}:${sp(width)},${sp(ASCENT)},${sp(DESCENT)}`);
      let offset = 0;
      for (const word of line.text.split(" ")) {
        offset += word.length;
        if (word) out.push(`g${line.tag},${line.line}:${sp(MARGIN + offset * ADVANCE)},${v}`);
        offset += 1;
      }
      out.push(")");
    });
    out.push("]", `}${number}`);
  });
  out.push("Postamble:", `Count:${pages.length}`, "Post scriptum:");
  return `${out.join("\n")}\n`;
}

function fakeLog(main: string, collected: Collected, pages: number): string {
  const lines = ["This is FakeTeX, Version 0.0 (Oleafly test engine)", `(./${main}`];
  for (const failure of collected.failures) {
    const nested = failure.path !== main;
    if (nested) lines.push(`(./${failure.path}`);
    lines.push("! Undefined control sequence.", `l.${failure.line} ${failure.text}`, "");
    if (nested) lines.push(")");
  }
  lines.push(")", `Output written on ${main.replace(/\.[^./]+$/u, "")}.pdf (${pages} page${pages === 1 ? "" : "s"}).`);
  return `${lines.join("\n")}\n`;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CompileStopped());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new CompileStopped());
      },
      { once: true },
    );
  });
}

export function createFakeEngine(options: FakeEngineOptions = {}): BrowserEngine {
  const engines = new Set<DocumentEngineId>(options.engines ?? ["latex", "latexmk", "typst", "markdown"]);
  return {
    accepts: (target) => engines.has(target.engine),
    async run({ target, sources, signal }): Promise<EngineResult> {
      if (options.delayMs) await wait(options.delayMs, signal);
      const main = target.mainDocument;
      const collected: Collected = { inputs: [], lines: [], failures: [] };
      if (!collect(sources, main, 0, collected)) {
        return { ok: false, pdf: null, synctex: null, log: `! I can't find file \`${main}'.\n` };
      }
      const pages = paginate(collected.lines);
      return {
        ok: collected.failures.length === 0,
        pdf: fakePdf(pages),
        synctex: gzipSync(strToU8(fakeSyncTex(collected.inputs, pages)), { mtime: 0 }),
        log: fakeLog(main, collected, pages.length),
      };
    },
  };
}

import { matchingBrace } from "@oleafly/latex";
import { maskComments } from "../mask";
import { message } from "../messages";
import type { Finding } from "../types";
import type { ProjectWritingFile, ProjectWritingRule } from "./index";
import { isProse, proseView, type ProseView } from "./prose";
import { ABBREVIATIONS, writingFingerprint, writingFinding } from "./rules";

export interface TextSpan {
  readonly from: number;
  readonly to: number;
}

const RULE_ID = "writing-open-promise";
const LIMIT = 200;
const LATEX_DOCUMENT = /\.(?:tex|ltx)$/i;
const REBUTTAL_FILE = /rebuttal|response/i;
const SUPPLEMENT_FILE = /supp|appendi/i;
const STRUCTURAL = /\\(?:begin|end|item|par|caption|captionof|part|chapter|(?:sub){0,2}section|(?:sub)?paragraph)(?![A-Za-z])\*?/y;
const HEADING = /\\(?:part|chapter|(?:sub){0,2}section|(?:sub)?paragraph|title)\*?\s*(?:\[[^\]]*\]\s*)?\{/g;
const PARAGRAPH_BREAK = /\n[ \t]*\n/y;
const CLOSERS = new Set([")", "\"", "'", "}", "]"]);
const SUPPLEMENT_PHRASE = "(?:in|see) (?:the |our )?supplement(?:ary|al)?(?: materials?)?";
const SUPPLEMENT_MATERIALS = "supplement(?:ary|al) materials?";
const SUPP_ABBREVIATION = String.raw`supp\.`;
const APPENDIX_PHRASE = "(?:in|see) (?:the )?appendi(?:x|ces)";
const POINTER = new RegExp(
  String.raw`\b(?:${SUPPLEMENT_PHRASE}|${SUPPLEMENT_MATERIALS}|${SUPP_ABBREVIATION}|${APPENDIX_PHRASE})(?![a-z])`,
  "gi",
);
const CODE_WILL_BE = "(?:our )?code(?: and (?:data|models?|weights))? will (?:also )?be(?: (?:made )?(?:publicly )?(?:released|available|published|shared))?";
const WE_WILL = "we(?: will|'ll|’ll) (?:also |further |then |[a-z]+ly )?(?:add|include|release|provide|clarify|revise|update|discuss|report|fix|make|publish)";
const WILL_BE_DONE = "will (?:also )?be (?:released|made (?:publicly )?available|added|included|provided|clarified|updated|published)";
const FINAL_VERSION = "in the final (?:version|paper|manuscript)";
const CAMERA_READY = "in the camera[- ]ready(?: version| paper)?";
const COMMITMENT = new RegExp(
  String.raw`\b(?:${CODE_WILL_BE}|${WE_WILL}|${WILL_BE_DONE}|${FINAL_VERSION}|${CAMERA_READY})(?![a-z])`,
  "gi",
);
const REFERENCE_COMMAND = String.raw`\\(?:ref|cref|Cref|autoref|nameref|eqref|vref|Vref|pageref|cpageref|labelcref)\*?\s*\{([^{}]*)\}`;
const HYPERREF_COMMAND = String.raw`\\hyperref\s*\[([^\]]*)\]`;
const REFERENCE = new RegExp(`${REFERENCE_COMMAND}|${HYPERREF_COMMAND}`, "g");
const RELEASE = /\b(?:releas|availab|publish|shar|code|data|models?\b|weights)/i;
const LINK = /\\(?:url|href)\s*\{/;

export function trimQuote(text: string, limit = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

export function collectLabels(files: readonly ProjectWritingFile[]): Set<string> {
  const labels = new Set<string>();
  for (const file of files) {
    if (!LATEX_DOCUMENT.test(file.path)) continue;
    for (const match of maskComments(file.content).matchAll(/\\label\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/g)) {
      labels.add(match[1].trim());
    }
  }
  return labels;
}

function endsSentence(prose: string, at: number): boolean {
  let next = at + 1;
  while (next < prose.length && CLOSERS.has(prose[next])) next += 1;
  if (next < prose.length && !/\s/.test(prose[next])) return false;
  if (prose[at] !== ".") return true;
  let start = at - 1;
  while (start >= 0 && /[A-Za-z.]/.test(prose[start])) start -= 1;
  const word = prose.slice(start + 1, at);
  if (ABBREVIATIONS.has(word) || /^[A-Z]$/.test(word)) return false;
  while (next < prose.length && /\s/.test(prose[next])) next += 1;
  return next >= prose.length || !/[a-z]/.test(prose[next]);
}

interface SentenceScan {
  readonly view: ProseView;
  readonly spans: TextSpan[];
  start: number;
}

function closeSentence(scan: SentenceScan, end: number): void {
  const { prose } = scan.view;
  let to = end;
  while (scan.start >= 0 && to > scan.start && /\s/.test(prose[to - 1])) to -= 1;
  if (scan.start >= 0 && to > scan.start) scan.spans.push({ from: scan.start, to });
  scan.start = -1;
}

function scanNewline(scan: SentenceScan, index: number): number {
  PARAGRAPH_BREAK.lastIndex = index;
  if (PARAGRAPH_BREAK.test(scan.view.text)) closeSentence(scan, index);
  return index + 1;
}

function scanBackslash(scan: SentenceScan, index: number): number {
  const { prose } = scan.view;
  STRUCTURAL.lastIndex = index;
  const command = STRUCTURAL.exec(prose);
  if (command) {
    closeSentence(scan, index);
    return index + command[0].length;
  }
  if (scan.start < 0) scan.start = index;
  return /[A-Za-z]/.test(prose[index + 1] ?? "") ? index + 1 : index + 2;
}

function scanCharacter(scan: SentenceScan, index: number): number {
  const { prose } = scan.view;
  const character = prose[index];
  if (scan.start < 0) {
    if (/[\s{}[\]]/.test(character)) return index + 1;
    scan.start = index;
  }
  if (!/[.!?]/.test(character) || !endsSentence(prose, index)) return index + 1;
  let end = index + 1;
  while (end < prose.length && CLOSERS.has(prose[end])) end += 1;
  closeSentence(scan, end);
  return end;
}

function scanStep(scan: SentenceScan, index: number): number {
  const character = scan.view.prose[index];
  if (character === "\n") return scanNewline(scan, index);
  if (character === "\\") return scanBackslash(scan, index);
  return scanCharacter(scan, index);
}

export function splitSentences(view: ProseView): TextSpan[] {
  const scan: SentenceScan = { view, spans: [], start: -1 };
  let index = view.bodyStart;
  while (index < view.prose.length) index = scanStep(scan, index);
  closeSentence(scan, view.prose.length);
  return scan.spans;
}

function withoutHeadings(view: ProseView): ProseView {
  const chars = view.prose.split("");
  for (const match of view.prose.matchAll(HEADING)) {
    const open = match.index + match[0].length - 1;
    const close = matchingBrace(view.prose, open);
    const end = close < 0 ? open + 1 : close + 1;
    for (let index = open; index < end; index += 1) if (chars[index] !== "\n") chars[index] = " ";
  }
  return { ...view, prose: chars.join("") };
}

function firstMatch(pattern: RegExp, view: ProseView, span: TextSpan): TextSpan | null {
  for (const match of view.prose.slice(span.from, span.to).matchAll(pattern)) {
    const from = span.from + match.index;
    const to = from + match[0].length;
    if (isProse(view, from, to)) return { from, to };
  }
  return null;
}

function kept(sentence: string, labels: ReadonlySet<string>, commitment: boolean): boolean {
  for (const match of sentence.matchAll(REFERENCE)) {
    if ((match[1] ?? match[2] ?? "").split(",").some((name) => labels.has(name.trim()))) return true;
  }
  return commitment && LINK.test(sentence) && RELEASE.test(sentence);
}

function baseName(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() ?? path;
}

function filePromises(file: ProjectWritingFile, labels: ReadonlySet<string>): Finding[] {
  const name = baseName(file.path);
  const rebuttal = REBUTTAL_FILE.test(name);
  const pointers = !rebuttal && !SUPPLEMENT_FILE.test(name);
  const view = withoutHeadings(proseView(file.content));
  const source = maskComments(file.content);
  const out: Finding[] = [];
  for (const span of splitSentences(view)) {
    const commitment = firstMatch(COMMITMENT, view, span);
    const pointer = pointers ? firstMatch(POINTER, view, span) : null;
    const phrase = commitment && (!pointer || commitment.from <= pointer.from) ? commitment : pointer;
    if (!phrase) continue;
    const sentence = source.slice(span.from, span.to);
    if (kept(sentence, labels, commitment !== null)) continue;
    out.push({
      ...writingFinding(RULE_ID, view, phrase.from, phrase.to, {
        title: message(rebuttal ? "rules.writing-open-promise.titleRebuttal" : "rules.writing-open-promise.title"),
        detail: message(rebuttal ? "rules.writing-open-promise.detailRebuttal" : "rules.writing-open-promise.detail", {
          sentence: trimQuote(sentence),
        }),
        fingerprint: writingFingerprint(RULE_ID, sentence),
      }),
      file: file.path,
    });
  }
  return out;
}

export const openPromiseRule: ProjectWritingRule = {
  id: RULE_ID,
  run: (files) => {
    const labels = collectLabels(files);
    return files
      .filter((file) => LATEX_DOCUMENT.test(file.path))
      .flatMap((file) => filePromises(file, labels))
      .slice(0, LIMIT);
  },
};

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
const POINTER =
  /\b(?:(?:in|see) (?:the |our )?supplement(?:ary|al)?(?: materials?)?|supplement(?:ary|al) materials?|supp\.|(?:in|see) (?:the )?appendi(?:x|ces))(?![A-Za-z])/gi;
const COMMITMENT =
  /\b(?:(?:our )?code(?: and (?:data|models?|weights))? will (?:also )?be(?: (?:made )?(?:publicly )?(?:released|available|published|shared))?|we(?: will|'ll|’ll) (?:also |further |then |[a-z]+ly )?(?:add|include|release|provide|clarify|revise|update|discuss|report|fix|make|publish)|will (?:also )?be (?:released|made (?:publicly )?available|added|included|provided|clarified|updated|published)|in the final (?:version|paper|manuscript)|in the camera[- ]ready(?: version| paper)?)(?![A-Za-z])/gi;
const REFERENCE =
  /\\(?:ref|cref|Cref|autoref|nameref|eqref|vref|Vref|pageref|cpageref|labelcref)\*?\s*\{([^{}]*)\}|\\hyperref\s*\[([^\]]*)\]/g;
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

export function splitSentences(view: ProseView): TextSpan[] {
  const { text, prose } = view;
  const spans: TextSpan[] = [];
  let start = -1;
  const close = (end: number) => {
    let to = end;
    while (start >= 0 && to > start && /\s/.test(prose[to - 1])) to -= 1;
    if (start >= 0 && to > start) spans.push({ from: start, to });
    start = -1;
  };
  for (let index = view.bodyStart; index < prose.length; index += 1) {
    const character = prose[index];
    if (character === "\n") {
      PARAGRAPH_BREAK.lastIndex = index;
      if (PARAGRAPH_BREAK.test(text)) close(index);
      continue;
    }
    if (character === "\\") {
      STRUCTURAL.lastIndex = index;
      const command = STRUCTURAL.exec(prose);
      if (command) {
        close(index);
        index += command[0].length - 1;
        continue;
      }
      if (start < 0) start = index;
      if (!/[A-Za-z]/.test(prose[index + 1] ?? "")) index += 1;
      continue;
    }
    if (start < 0) {
      if (/[\s{}[\]]/.test(character)) continue;
      start = index;
    }
    if (/[.!?]/.test(character) && endsSentence(prose, index)) {
      let end = index + 1;
      while (end < prose.length && CLOSERS.has(prose[end])) end += 1;
      close(end);
      index = end - 1;
    }
  }
  close(prose.length);
  return spans;
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

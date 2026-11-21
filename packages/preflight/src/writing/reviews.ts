import { matchingBrace } from "@oleafly/latex";
import { maskComments } from "../mask";
import { message } from "../messages";
import type { Finding } from "../types";
import { directoryOf, normalizeProjectPath } from "../typst-scan";
import type { ProjectWritingFile, ProjectWritingRule } from "./index";
import { trimQuote, type TextSpan } from "./promises";
import { DISPLAY_MATH_ENVIRONMENTS, OPAQUE_ENVIRONMENTS, environmentEnd, type ProseView } from "./prose";
import { writingFingerprint, writingFinding } from "./rules";

export type PaperPlaceKind = "table" | "figure" | "equation" | "section";
export type ReviewReferenceKind = PaperPlaceKind | "line";

export interface PaperPlace {
  readonly kind: PaperPlaceKind;
  readonly number: string;
  readonly file: string;
  readonly from: number;
  readonly to: number;
}

export interface ReviewReference {
  readonly kind: ReviewReferenceKind;
  readonly number: string;
}

export interface ReviewPoint {
  readonly label: string;
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

const RULE_ID = "writing-review-point";
const LIMIT = 200;
const MAX_DEPTH = 16;
const POINT_LIMIT = 280;
const REVIEWS_FILE = /(?:^|\/)reviews\.(?:md|txt)$/i;
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const REVIEWER_ID = String.raw`(\d+|[A-Za-z0-9]{4}(?![A-Za-z0-9]))`;
const REVIEWER_IN_HEADING = new RegExp(String.raw`\breviewer\s*#?\s*${REVIEWER_ID}|^R(\d+)\b`, "i");
const REVIEWER_LINE = new RegExp(String.raw`^\s*(?:\*\*|__)?\s*reviewer\s*#?\s*${REVIEWER_ID}(?:\s*\([^)]*\))?[\s*_:.-]*$`, "i");
const NUMBERED = /^(\s*)(?:[-*+]\s+)?(?:\*\*|__)?(\d{1,3}(?=[.)])|[QWR]\d{1,3}(?:\.\d{1,3})*)[.):]?(?:\*\*|__)?[.):]?(?:\s+|$)/;
const BULLET = /^(\s*)[-*+]\s+(?=\S)/;
const REFERENCE_PATTERNS: readonly (readonly [ReviewReferenceKind, RegExp])[] = [
  ["table", /\b(?:tables?|tabs?\.?)\s*~?(\d+)/gi],
  ["figure", /\b(?:figures?|figs?\.?)\s*~?(\d+)/gi],
  ["equation", /\b(?:equations?|eqns?\.?|eqs?\.?)\s*~?\(?(\d+)\)?/gi],
  ["section", /(?:\b(?:sections?|secs?\.?)|§)\s*~?(\d+(?:\.\d+)*)/gi],
  ["line", /\b(?:[Ll]ines?|ll?\.)\s*(\d+)|\bL(\d+)\b/g],
];
const TOKEN =
  /\\(?:(input|include)\s*\{([^{}]*)\}|begin\s*\{([A-Za-z]+\*?)\}|(section|subsection|subsubsection)(\*?)\s*(?:\[[^\]]*\]\s*)?\{|(?:captionof\s*\{|captionsetup\s*\{\s*type\s*=\s*)(figure|table)\s*\}|(appendix)(?![A-Za-z])|end\s*\{document\})/g;
const FLOATS: Readonly<Record<string, "figure" | "table">> = {
  figure: "figure",
  "figure*": "figure",
  table: "table",
  "table*": "table",
};
const SINGLE_EQUATION = new Set(["equation", "multline"]);
const EQUATION_ROWS = new Set(["align", "gather", "eqnarray", "flalign", "alignat"]);
const UNNUMBERED_ROW = /\\(?:nonumber|notag|tag)(?![A-Za-z])/;
const SECTION_LEVELS: Readonly<Record<string, number>> = { section: 0, subsection: 1, subsubsection: 2 };

export function isReviewsFile(path: string): boolean {
  return REVIEWS_FILE.test(path.replaceAll("\\", "/"));
}

function reviewerName(line: string): string | null {
  const heading = MARKDOWN_HEADING.exec(line);
  const match = heading ? REVIEWER_IN_HEADING.exec(heading[1]) : REVIEWER_LINE.exec(line);
  return match ? (match[1] ?? match[2]) : null;
}

function pointLabel(reviewer: string | null, marker: string): string {
  if (reviewer === null || marker.startsWith("R")) return marker;
  return `${/^\d+$/.test(reviewer) ? `R${reviewer}` : reviewer}.${marker}`;
}

interface OpenPoint {
  label: string;
  lines: string[];
  from: number;
  to: number;
  indent: number;
  bullet: boolean;
}

export function reviewPoints(content: string): ReviewPoint[] {
  const points: OpenPoint[] = [];
  let reviewer: string | null = null;
  let count = 0;
  let current: OpenPoint | null = null;
  let offset = 0;
  for (const line of content.split("\n")) {
    const lineFrom = offset;
    offset += line.length + 1;
    if (line.trim() === "") {
      current = null;
      continue;
    }
    const name = reviewerName(line);
    if (name !== null) {
      reviewer = name;
      count = 0;
      current = null;
      continue;
    }
    if (MARKDOWN_HEADING.test(line)) {
      current = null;
      continue;
    }
    const numbered = NUMBERED.exec(line);
    const bullet = numbered ? null : BULLET.exec(line);
    const start = numbered ?? bullet;
    const nested = current !== null && start !== null && start[1].length > current.indent;
    const opens = numbered !== null || (bullet !== null && reviewer !== null && (current === null || current.bullet));
    if (start && opens && !nested) {
      count += 1;
      current = {
        label: pointLabel(reviewer, numbered ? numbered[2] : String(count)),
        lines: [line.slice(start[0].length)],
        from: lineFrom + start[1].length,
        to: lineFrom + line.trimEnd().length,
        indent: start[1].length,
        bullet: numbered === null,
      };
      points.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return points.map(({ label, lines, from, to }) => ({
    label,
    text: lines.join(" ").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim(),
    from,
    to,
  }));
}

export function reviewReferences(text: string): ReviewReference[] {
  const found: { at: number; reference: ReviewReference }[] = [];
  const seen = new Set<string>();
  for (const [kind, pattern] of REFERENCE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const number = match[1] ?? match[2];
      if (seen.has(`${kind} ${number}`)) continue;
      seen.add(`${kind} ${number}`);
      found.push({ at: match.index, reference: { kind, number } });
    }
  }
  return found.sort((left, right) => left.at - right.at).map((entry) => entry.reference);
}

function inputPath(base: string, target: string, contents: ReadonlyMap<string, string>): string | null {
  const clean = target.trim();
  if (!clean || clean.startsWith("/")) return null;
  const path = normalizeProjectPath(base + clean);
  if (path === null) return null;
  const candidates = /\.tex$/i.test(path) ? [path] : [`${path}.tex`, path];
  return candidates.find((candidate) => contents.has(candidate)) ?? null;
}

function captionCount(body: string): number {
  const outer = body.replace(/\\begin\s*\{(sub(?:figure|table))\}[\s\S]*?\\end\s*\{\1\}/g, "");
  return (outer.match(/\\caption(?![A-Za-z*])/g) ?? []).length;
}

function equationRows(body: string): TextSpan[] {
  const rows: TextSpan[] = [];
  let braces = 0;
  let nested = 0;
  let start = 0;
  const push = (to: number) => {
    const text = body.slice(start, to);
    const lead = /^\s*(?:\[[^\]]*\])?\s*/.exec(text)?.[0].length ?? 0;
    const content = text.slice(lead).trimEnd();
    if (content.length > 0 && !UNNUMBERED_ROW.test(content)) rows.push({ from: start + lead, to: start + lead + content.length });
  };
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "\\") {
      if (body.startsWith("\\begin", index)) nested += 1;
      else if (body.startsWith("\\end", index)) nested -= 1;
      else if (body[index + 1] === "\\" && braces === 0 && nested === 0) {
        push(index);
        start = index + 2;
      }
      index += 1;
    }
  }
  push(body.length);
  return rows;
}

export function paperPlaces(files: readonly ProjectWritingFile[], mainFile: string): PaperPlace[] {
  const contents = new Map(files.map((file) => [file.path, file.content]));
  const base = directoryOf(mainFile);
  const places: PaperPlace[] = [];
  const counts = { table: 0, figure: 0, equation: 0 };
  const sections = [0, 0, 0];
  const active = new Set<string>();
  let appendix = false;
  const add = (kind: "table" | "figure" | "equation", file: string, from: number, to: number) => {
    counts[kind] += 1;
    places.push({ kind, number: String(counts[kind]), file, from, to });
  };
  const environment = (name: string, source: string, file: string, at: number, bodyFrom: number): number => {
    const end = environmentEnd(source, name, bodyFrom);
    if (end < 0) return bodyFrom;
    const body = source.slice(bodyFrom, source.lastIndexOf("\\end", end - 1));
    const float = FLOATS[name];
    if (float) {
      for (let caption = captionCount(body); caption > 0; caption -= 1) add(float, file, at, bodyFrom);
    } else if (name === "subequations") {
      add("equation", file, at, bodyFrom);
    } else if (SINGLE_EQUATION.has(name)) {
      if (!UNNUMBERED_ROW.test(body)) add("equation", file, at, bodyFrom);
    } else if (EQUATION_ROWS.has(name)) {
      for (const row of equationRows(body)) add("equation", file, bodyFrom + row.from, bodyFrom + row.to);
    } else if (!DISPLAY_MATH_ENVIRONMENTS.has(name) && !OPAQUE_ENVIRONMENTS.has(name)) {
      return bodyFrom;
    }
    return end;
  };
  const section = (command: string, source: string, file: string, at: number, open: number) => {
    const level = SECTION_LEVELS[command];
    sections[level] += 1;
    sections.fill(0, level + 1);
    const close = matchingBrace(source, open);
    places.push({ kind: "section", number: sections.slice(0, level + 1).join("."), file, from: at, to: close < 0 ? open + 1 : close + 1 });
  };
  const walk = (file: string, depth: number): boolean => {
    const content = contents.get(file);
    if (content === undefined || depth > MAX_DEPTH || active.has(file)) return true;
    active.add(file);
    const source = maskComments(content);
    const token = new RegExp(TOKEN.source, "g");
    let going = true;
    for (let match = token.exec(source); match && going; match = token.exec(source)) {
      const [whole, input, target, name, heading, starred, captioned, appendixCommand] = match;
      const after = match.index + whole.length;
      if (input) {
        const next = inputPath(base, target, contents);
        if (next) going = walk(next, depth + 1);
      } else if (name) {
        token.lastIndex = environment(name, source, file, match.index, after);
      } else if (heading) {
        if (!starred && !appendix) section(heading, source, file, match.index, after - 1);
      } else if (captioned) {
        add(captioned === "figure" ? "figure" : "table", file, match.index, after);
      } else if (appendixCommand) {
        appendix = true;
      } else {
        going = false;
      }
    }
    active.delete(file);
    return going;
  };
  walk(mainFile, 0);
  return places;
}

function pointFindings(file: ProjectWritingFile, places: readonly PaperPlace[]): Finding[] {
  const view: ProseView = { text: file.content, prose: file.content, bodyStart: 0 };
  return reviewPoints(file.content).flatMap((point) => {
    const references = reviewReferences(point.text);
    const quoted = trimQuote(point.text, POINT_LIMIT);
    const mapped = references.flatMap((reference) => {
      const place = places.find((candidate) => candidate.kind === reference.kind && candidate.number === reference.number);
      return place ? [place] : [];
    });
    if (mapped.length > 0) {
      return mapped.map((place) => ({
        ...writingFinding(RULE_ID, view, place.from, place.to, {
          title: message("rules.writing-review-point.title", { n: point.label }),
          detail: message("rules.writing-review-point.detail", { point: quoted }),
          fingerprint: writingFingerprint(RULE_ID, `${point.label} ${place.kind} ${place.number} ${point.text}`),
        }),
        file: place.file,
      }));
    }
    const lines = references.some((reference) => reference.kind === "line");
    return [
      {
        ...writingFinding(RULE_ID, view, point.from, point.to, {
          title: message("rules.writing-review-point.titleUnplaced", { n: point.label }),
          detail: message(lines ? "rules.writing-review-point.detailLines" : "rules.writing-review-point.detailUnplaced", {
            point: quoted,
          }),
          fingerprint: writingFingerprint(RULE_ID, `${point.label} ${point.text}`),
        }),
        file: file.path,
      },
    ];
  });
}

export const reviewPointRule: ProjectWritingRule = {
  id: RULE_ID,
  run: (files, context) => {
    const reviews = files.filter((file) => isReviewsFile(file.path));
    if (reviews.length === 0) return [];
    const places = paperPlaces(files, context.mainFile);
    return reviews.flatMap((file) => pointFindings(file, places)).slice(0, LIMIT);
  },
};

import { message, type MessageRef } from "./messages";
import { annotate } from "./standards";
import { typstPathReferences, typstTemplateCalls } from "./typst-references";
import {
  type TypstCall,
  type TypstScan,
  TYPST_MARKUP,
  callAt,
  closingBracket,
  isBlankValue,
  namedArgument,
  positionalArgument,
  scanTypst,
  stringValue,
  typstCalls,
  typstVersionAtLeast,
} from "./typst-scan";
import type { Finding, Lens, Severity } from "./types";

export const DEFAULT_TYPST_VERSION = "0.15.1";
const FIGURE_ALT_SINCE = [0, 14, 0] as const;

export interface TypstSourceRuleContext {
  readonly version?: string;
}

const make = (
  id: string,
  lens: Lens,
  severity: Severity,
  title: MessageRef,
  detail: MessageRef,
  range?: { from: number; to: number },
  certainty?: Finding["certainty"],
): Finding => ({ id, lens, severity, title, detail, ...range, ...(certainty ? { certainty } : {}) });

function fileName(path: string): string {
  return (path.replaceAll("\\", "/").split("/").pop() ?? path).toLowerCase();
}

function figureAltCovers(scan: TypstScan, figures: readonly TypstCall[], offset: number): boolean {
  return figures.some((figure) => {
    if (offset <= figure.open || offset >= figure.close) return false;
    const alt = namedArgument(figure, "alt");
    return alt !== undefined && !isBlankValue(scan, alt.valueFrom, alt.valueTo);
  });
}

function weakAlt(scan: TypstScan, call: TypstCall): boolean {
  const alt = namedArgument(call, "alt");
  if (!alt) return true;
  if (isBlankValue(scan, alt.valueFrom, alt.valueTo)) return true;
  const value = stringValue(scan, alt.valueFrom, alt.valueTo);
  const path = positionalArgument(scan, call);
  const source = path && stringValue(scan, path.valueFrom, path.valueTo);
  if (!value || !source) return false;
  const description = value.value.trim().toLowerCase();
  return description === source.value.trim().toLowerCase() || description === fileName(source.value);
}

function figureAlt(scan: TypstScan, context: TypstSourceRuleContext): Finding[] {
  const figureAltSupported = typstVersionAtLeast(context.version ?? DEFAULT_TYPST_VERSION, FIGURE_ALT_SINCE);
  const figures = figureAltSupported ? typstCalls(scan, ["figure"]) : [];
  return typstCalls(scan, ["image"])
    .filter((call) => weakAlt(scan, call) && !figureAltCovers(scan, figures, call.from))
    .map((call) =>
      make(
        "figure-alt",
        "a11y",
        "warning",
        message("rules.figure-alt.title"),
        message(figureAltSupported ? "rules.figure-alt.detailTypstFigure" : "rules.figure-alt.detailTypst"),
        { from: call.from, to: call.close + 1 },
      ),
    );
}

function headingMarkers(scan: TypstScan): Finding[] {
  const out: Finding[] = [];
  let offset = 0;
  for (const line of scan.masked.split("\n")) {
    const marker = /^([ \t]*)(=+)(?=[ \t]|$)/.exec(line);
    if (marker && scan.kinds[offset + marker[1].length] === TYPST_MARKUP) {
      const rest = line.slice(marker[0].length).replace(/<[^<>\s]*>\s*$/, "").trim();
      if (!rest) {
        const from = offset + marker[1].length;
        out.push(
          make(
            "empty-heading",
            "a11y",
            "warning",
            message("rules.empty-heading.title"),
            message("rules.empty-heading.detail"),
            { from, to: offset + line.trimEnd().length },
          ),
        );
      }
    }
    offset += line.length + 1;
  }
  return out;
}

function trailingContentEmpty(scan: TypstScan, open: number): boolean | null {
  if (scan.code[open] !== "[") return null;
  const close = closingBracket(scan, open);
  return scan.text.slice(open + 1, close).trim() === "";
}

function headingCallIsEmpty(scan: TypstScan, nameEnd: number): { empty: boolean; to: number } {
  let cursor = nameEnd;
  while (/\s/.test(scan.code[cursor] ?? "")) cursor++;
  if (scan.code[cursor] === "[") {
    const close = closingBracket(scan, cursor);
    return { empty: trailingContentEmpty(scan, cursor) === true, to: close + 1 };
  }
  const call = callAt(scan, "heading", nameEnd, cursor);
  let after = call.close + 1;
  while (/[ \t]/.test(scan.code[after] ?? "")) after++;
  const trailing = trailingContentEmpty(scan, after);
  if (trailing !== null) return { empty: trailing, to: closingBracket(scan, after) + 1 };
  const body = positionalArgument(scan, call);
  return { empty: !body || isBlankValue(scan, body.valueFrom, body.valueTo), to: call.close + 1 };
}

function headingCalls(scan: TypstScan): Finding[] {
  const out: Finding[] = [];
  for (const match of scan.code.matchAll(/(?<![\p{L}\p{N}_.-])heading\s*(?=[([])/gu)) {
    const before = scan.code.slice(Math.max(0, match.index - 8), match.index);
    if (/(?:set|show)\s+$/.test(before)) continue;
    const { empty, to } = headingCallIsEmpty(scan, match.index + "heading".length);
    if (!empty) continue;
    out.push(
      make(
        "empty-heading",
        "a11y",
        "warning",
        message("rules.empty-heading.title"),
        message("rules.empty-heading.detail"),
        { from: match.index, to },
      ),
    );
  }
  return out;
}

function draftNotes(scan: TypstScan): Finding[] {
  return [...scan.markup.matchAll(/\b(?:TODO|FIXME|TBD)\b/g)].map((match) =>
    make(
      "todo-in-text",
      "submission",
      "warning",
      message("rules.todo-in-text.title"),
      message("rules.todo-in-text.detail"),
      { from: match.index, to: match.index + match[0].length },
      "advisory",
    ),
  );
}

const LOCAL_PATH =
  /^(?:~[\\/]|\/(?:Users|home|root|Volumes|mnt|media|private|tmp|var)\/[^/\\]|[A-Za-z]:[\\/]|\\\\[^\\])/;

function localPaths(scan: TypstScan): Finding[] {
  return typstPathReferences(scan)
    .filter((reference) => LOCAL_PATH.test(reference.raw))
    .map((reference) =>
      make(
        "privacy-local-path",
        "privacy",
        "warning",
        message("rules.privacy-local-path.title", { path: reference.raw }),
        message("rules.privacy-local-path.detail"),
        { from: reference.from, to: reference.to },
      ),
    );
}

export function typstSourceFindings(scan: TypstScan, context: TypstSourceRuleContext = {}): Finding[] {
  return [
    ...figureAlt(scan, context),
    ...headingMarkers(scan),
    ...headingCalls(scan),
    ...draftNotes(scan),
    ...localPaths(scan),
  ]
    .map((finding) => annotate(finding, "source-heuristic"))
    .sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
}

export function runTypstSourceRules(text: string, context: TypstSourceRuleContext = {}): Finding[] {
  return typstSourceFindings(scanTypst(text), context);
}

interface MetadataPresence {
  title: boolean;
  author: boolean;
}

function presentIn(scan: TypstScan, call: TypstCall, name: RegExp): boolean {
  return call.args.some(
    (arg) => arg.name !== null && name.test(arg.name) && !isBlankValue(scan, arg.valueFrom, arg.valueTo),
  );
}

function metadataPresence(scan: TypstScan): MetadataPresence {
  const documents = typstCalls(scan, ["document"]).filter((call) =>
    /(?<![\p{L}\p{N}_.-])set\s+$/u.test(scan.code.slice(Math.max(0, call.from - 8), call.from)),
  );
  const templates = typstTemplateCalls(scan);
  return {
    title:
      documents.some((call) => presentIn(scan, call, /^title$/)) ||
      templates.some((call) => presentIn(scan, call, /^title(?:[-_].+)?$/)),
    author:
      documents.some((call) => presentIn(scan, call, /^author$/)) ||
      templates.some((call) => presentIn(scan, call, /^authors?(?:[-_].+)?$/)),
  };
}

export function typstMetadataFindings(
  sources: readonly { path: string; content: string }[],
  options: { anonymousReview: boolean },
): Finding[] {
  const presence = sources
    .map((source) => metadataPresence(scanTypst(source.content)))
    .reduce((all, next) => ({ title: all.title || next.title, author: all.author || next.author }), {
      title: false,
      author: false,
    });
  const out: Finding[] = [];
  if (!presence.title) {
    out.push(
      annotate(
        make("no-title", "a11y", "warning", message("rules.no-title.title"), message("rules.no-title.detailTypst")),
        "source-heuristic",
      ),
    );
  }
  if (!presence.author && !options.anonymousReview) {
    out.push(
      make(
        "no-author",
        "submission",
        "info",
        message("rules.no-author.title"),
        message("rules.no-author.detail"),
        undefined,
        "advisory",
      ),
    );
  }
  return out;
}

import { message, type MessageParams, type MessageRef, type PreflightMessageKey } from "../messages";
import type { Finding, FindingFix, TextEdit } from "../types";
import type { MacroText } from "./macros";
import { DISPLAY_MATH_ENVIRONMENTS, environmentEnd, escapeRegExp, isProse, type ProseView } from "./prose";
import type { CustomWritingRule, ResolvedWritingProfile } from "./settings";

export const WRITING_RULE_IDS = [
  "writing-space-before-paren",
  "writing-space-before-punctuation",
  "writing-nonbreaking-reference",
  "writing-straight-quotes",
  "writing-cite-in-abstract",
  "writing-abbreviation-at-sentence-start",
  "writing-display-math-punctuation",
  "writing-table-caption-below",
  "writing-figure-caption-above",
  "writing-macro-available",
  "writing-table-abbreviation",
  "writing-unnumbered-equation",
  "writing-float-placement",
  "writing-name-variants",
  "writing-symbol-redefined",
  "writing-results-best",
  "writing-custom",
  "writing-open-promise",
  "writing-review-point",
] as const;

export type WritingRuleId = (typeof WRITING_RULE_IDS)[number];

export interface WritingRun {
  readonly view: ProseView;
  readonly source: string;
  readonly profile: ResolvedWritingProfile;
  readonly macros: readonly MacroText[];
}

export interface WritingRule {
  readonly id: WritingRuleId;
  readonly profiles: readonly ResolvedWritingProfile[];
  readonly run: (run: WritingRun) => Finding[];
}

const EVERY: readonly ResolvedWritingProfile[] = ["general", "cvpr"];
const CVPR: readonly ResolvedWritingProfile[] = ["cvpr"];
const PER_RULE_LIMIT = 200;

export function writingFingerprint(id: string, matched: string): string {
  return `${id}:${matched.replace(/\s+/g, " ").trim().slice(0, 120)}`;
}

function key(id: string, part: string): PreflightMessageKey {
  return `rules.${id}.${part}` as PreflightMessageKey;
}

export function writingFinding(
  id: string,
  view: ProseView,
  from: number,
  to: number,
  options: { fix?: FindingFix; detail?: MessageRef; title?: MessageRef; fingerprint?: string } = {},
): Finding {
  return {
    id,
    lens: "writing",
    severity: "info",
    title: options.title ?? message(key(id, "title")),
    detail: options.detail ?? message(key(id, "detail")),
    from,
    to,
    certainty: "advisory",
    method: "source-heuristic",
    fingerprint: options.fingerprint ?? writingFingerprint(id, view.text.slice(from, to)),
    ...(options.fix ? { fix: options.fix } : {}),
  };
}

export function fix(label: PreflightMessageKey, edits: TextEdit[], params?: MessageParams): FindingFix {
  return { label: message(label, params), edits };
}

function eachDisplayMath(source: string, visit: (from: number, to: number, body: string) => void): void {
  let count = 0;
  for (let open = source.indexOf("\\["); open >= 0 && count < PER_RULE_LIMIT * 4; count += 1) {
    const close = source.indexOf("\\]", open + 2);
    if (close < 0) return;
    visit(open, close + 2, source.slice(open + 2, close));
    open = source.indexOf("\\[", close + 2);
  }
}

function each(pattern: RegExp, text: string, visit: (match: RegExpExecArray) => void): void {
  pattern.lastIndex = 0;
  let count = 0;
  for (let match = pattern.exec(text); match && count < PER_RULE_LIMIT * 4; match = pattern.exec(text)) {
    if (match[0].length === 0) pattern.lastIndex += 1;
    visit(match);
    count += 1;
  }
}

export function capped(findings: Finding[]): Finding[] {
  return findings.length > PER_RULE_LIMIT ? findings.slice(0, PER_RULE_LIMIT) : findings;
}

export const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "e.g", "i.e", "al", "cf", "vs", "etc", "Fig", "Figs", "Eq", "Eqs", "Sec", "Secs", "Tab", "Tabs", "No", "Dr", "Prof", "Mr", "Ms", "Mrs", "St", "approx", "resp", "w.r.t", "ca",
]);

function sentenceStart(text: string, at: number, floor: number): boolean {
  let index = at - 1;
  while (index >= floor && (text[index] === " " || text[index] === "\t")) index -= 1;
  if (index < floor) return true;
  if (text[index] === "\n") {
    let back = index - 1;
    while (back >= floor && (text[back] === " " || text[back] === "\t")) back -= 1;
    if (back < floor || text[back] === "\n") return true;
    index = back;
    if (!/[.!?]/.test(text[index]) && !/["')}]/.test(text[index])) return false;
  }
  while (index >= floor && /["')}]/.test(text[index])) index -= 1;
  if (index < floor || !/[.!?]/.test(text[index])) return false;
  if (text[index] !== ".") return true;
  let start = index - 1;
  while (start >= floor && /[A-Za-z.]/.test(text[start])) start -= 1;
  const word = text.slice(start + 1, index);
  return !ABBREVIATIONS.has(word) && !/^[A-Z]$/.test(word);
}

const spaceBeforeParen: WritingRule = {
  id: "writing-space-before-paren",
  profiles: EVERY,
  run: ({ view }) => {
    const out: Finding[] = [];
    each(/[A-Za-z]{2}\((?=[A-Z][A-Za-z0-9.+-]{0,15}s?\))/g, view.text, (match) => {
      let start = match.index;
      while (start > 0 && /[A-Za-z]/.test(view.text[start - 1])) start -= 1;
      if (view.text[start - 1] === "\\" || view.text[start - 1] === "@") return;
      const paren = match.index + 2;
      const close = view.text.indexOf(")", paren);
      if (close < 0 || !isProse(view, start, close + 1)) return;
      out.push(writingFinding(spaceBeforeParen.id, view, start, close + 1, {
        fix: fix("fixes.insertSpace", [{ from: paren, to: paren, insert: " " }]),
      }));
    });
    return capped(out);
  },
};

const spaceBeforePunctuation: WritingRule = {
  id: "writing-space-before-punctuation",
  profiles: EVERY,
  run: ({ view }) => {
    const out: Finding[] = [];
    each(/([^\s\\~{([&])([ \t]+)([.,;:!?])(?=[\s)}\]'"]|$)/g, view.text, (match) => {
      const spaceFrom = match.index + 1;
      const spaceTo = spaceFrom + match[2].length;
      if (!isProse(view, match.index, spaceTo + 1)) return;
      if (/\d/.test(match[1]) && match[3] === ":") return;
      out.push(writingFinding(spaceBeforePunctuation.id, view, match.index, spaceTo + 1, {
        fix: fix("fixes.removeSpace", [{ from: spaceFrom, to: spaceTo, insert: "" }]),
      }));
    });
    return capped(out);
  },
};

const REFERENCE_ABBREVIATION = /(?:^|[^A-Za-z])(?:Fig|Figs|Eq|Eqs|Sec|Secs|Tab|Tabs|Ref|Refs|Alg|App|Thm|Def|Lem|Prop|Cor|No|Chap|Ch)\.$/;

const nonbreakingReference: WritingRule = {
  id: "writing-nonbreaking-reference",
  profiles: EVERY,
  run: ({ view }) => {
    const out: Finding[] = [];
    each(/([A-Za-z0-9.)\]}])([ \t]*(?:\n[ \t]*)?)\\(cite|citep|ref|eqref|autoref|cref|pageref|vref)(?![A-Za-z@])/g, view.text, (match) => {
      const before = match.index;
      const gap = match[2];
      const command = before + 1 + gap.length;
      if (gap.includes("\n") && /\n[ \t]*$/.test(view.text.slice(0, before + 1))) return;
      if (!isProse(view, before, before + 1) || !isProse(view, command, command + match[3].length + 1)) return;
      if (match[1] === "." && !REFERENCE_ABBREVIATION.test(view.text.slice(Math.max(0, before - 6), before + 1))) return;
      if (match[1] === "}" && /\\(?:begin|end)\s*\{[^}]*$/.test(view.text.slice(Math.max(0, before - 40), before))) return;
      out.push(writingFinding(nonbreakingReference.id, view, before, command + match[3].length + 1, {
        fix: fix("fixes.useTilde", [{ from: before + 1, to: command, insert: "~" }]),
        fingerprint: writingFingerprint(nonbreakingReference.id, view.text.slice(Math.max(0, before - 20), command + match[3].length + 1)),
      }));
    });
    return capped(out);
  },
};

const SHORTHAND_QUOTES = /\\usepackage\s*\[[^\][]{0,300}\b(?:ngerman|german|naustrian|austrian|nswissgerman|swissgerman|dutch|afrikaans|swedish|finnish|danish|norsk|nynorsk|icelandic|estonian|slovene|serbian|croatian|czech|slovak|polish|bulgarian|russian|ukrainian|catalan|basque|galician|spanish|portuges|portuguese|brazil|brazilian)\b[^\]]*\]\s*\{babel\}|\\setmainlanguage\s*\{(?:german|dutch|russian|ukrainian|polish|czech)\}/;

const straightQuotes: WritingRule = {
  id: "writing-straight-quotes",
  profiles: EVERY,
  run: ({ view, source }) => {
    if (SHORTHAND_QUOTES.test(source)) return [];
    const out: Finding[] = [];
    const paragraphs = view.text.split(/(\n[ \t]*\n)/);
    let offset = 0;
    for (const paragraph of paragraphs) {
      const quotes: number[] = [];
      for (let index = 0; index < paragraph.length; index += 1) {
        const at = offset + index;
        if (paragraph[index] !== '"' || view.text[at - 1] === "\\" || !isProse(view, at, at + 1)) continue;
        quotes.push(at);
      }
      for (let index = 0; index < quotes.length; index += 2) {
        const open = quotes[index];
        const close = quotes[index + 1];
        if (close === undefined) {
          const opening = open === 0 || /[\s([{]/.test(view.text[open - 1]);
          out.push(writingFinding(straightQuotes.id, view, open, open + 1, {
            fix: fix("fixes.useTexQuotes", [{ from: open, to: open + 1, insert: opening ? "``" : "''" }]),
          }));
          continue;
        }
        out.push(writingFinding(straightQuotes.id, view, open, close + 1, {
          fix: fix("fixes.useTexQuotes", [
            { from: open, to: open + 1, insert: "``" },
            { from: close, to: close + 1, insert: "''" },
          ]),
        }));
      }
      offset += paragraph.length;
    }
    return capped(out);
  },
};

function environments(text: string, names: readonly string[], visit: (begin: number, bodyFrom: number, bodyTo: number, end: number, name: string) => void): void {
  const pattern = new RegExp(`\\\\begin\\s*\\{(${names.map(escapeRegExp).join("|")})\\}`, "g");
  const unclosed = new Set<string>();
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const name = match[1];
    if (unclosed.has(name)) continue;
    const bodyFrom = match.index + match[0].length;
    const end = environmentEnd(text, name, bodyFrom);
    if (end < 0) {
      unclosed.add(name);
      continue;
    }
    const bodyTo = text.lastIndexOf("\\end", end - 1);
    visit(match.index, bodyFrom, bodyTo, end, name);
    pattern.lastIndex = end;
  }
}

const citeInAbstract: WritingRule = {
  id: "writing-cite-in-abstract",
  profiles: EVERY,
  run: ({ view, source }) => {
    const out: Finding[] = [];
    environments(source, ["abstract"], (_begin, bodyFrom, bodyTo) => {
      each(/\\(?:cite[A-Za-z]*|nocite)\b\*?(?:\[[^\][]{0,200}\])*\s*\{[^}]{0,2000}\}/g, source.slice(bodyFrom, bodyTo), (match) => {
        out.push(writingFinding(citeInAbstract.id, view, bodyFrom + match.index, bodyFrom + match.index + match[0].length));
      });
    });
    return capped(out);
  },
};

const SPELLED_OUT: Readonly<Record<string, string>> = {
  Fig: "Figure",
  Figs: "Figures",
  Eq: "Equation",
  Eqs: "Equations",
  Sec: "Section",
  Secs: "Sections",
  Tab: "Table",
  Tabs: "Tables",
};

const abbreviationAtSentenceStart: WritingRule = {
  id: "writing-abbreviation-at-sentence-start",
  profiles: EVERY,
  run: ({ view }) => {
    const out: Finding[] = [];
    each(/(?<![A-Za-z\\])(Figs?|Eqs?|Secs?|Tabs?)\.(?=[ \t~]*(?:\\(?:ref|autoref|eqref)\b|\(?\d))/g, view.text, (match) => {
      const from = match.index;
      const to = from + match[0].length;
      if (!isProse(view, from, to) || !sentenceStart(view.text, from, view.bodyStart)) return;
      const word = SPELLED_OUT[match[1]];
      out.push(writingFinding(abbreviationAtSentenceStart.id, view, from, to, {
        fix: fix("fixes.spellOut", [{ from, to, insert: word }], { word }),
        detail: message("rules.writing-abbreviation-at-sentence-start.detail", { abbreviation: match[0], word }),
      }));
    });
    return capped(out);
  },
};

const tableAbbreviation: WritingRule = {
  id: "writing-table-abbreviation",
  profiles: CVPR,
  run: ({ view }) => {
    const out: Finding[] = [];
    each(/(?<![A-Za-z\\])(Tabs?)\.(?=[ \t~]*(?:\\(?:ref|autoref)\b|\d))/g, view.text, (match) => {
      const from = match.index;
      const to = from + match[0].length;
      if (!isProse(view, from, to) || sentenceStart(view.text, from, view.bodyStart)) return;
      const word = SPELLED_OUT[match[1]];
      out.push(writingFinding(tableAbbreviation.id, view, from, to, {
        fix: fix("fixes.spellOut", [{ from, to, insert: word }], { word }),
      }));
    });
    return capped(out);
  },
};

const TRAILING = /(?:\s+|\\label\s*\{[^{}]*\}|\\nonumber\b|\\notag\b|\\tag\*?\s*\{[^{}]*\}|\\\\\s*(?:\[[^\]]*\])?)$/;

function contentEnd(text: string, from: number, to: number): number {
  let end = to;
  for (let guard = 0; guard < 20; guard += 1) {
    const match = TRAILING.exec(text.slice(from, end));
    if (!match || match[0].length === 0) break;
    end -= match[0].length;
  }
  return end;
}

const displayMathPunctuation: WritingRule = {
  id: "writing-display-math-punctuation",
  profiles: EVERY,
  run: ({ view, source }) => {
    const out: Finding[] = [];
    const check = (bodyFrom: number, bodyTo: number, closeFrom: number, closeTo: number) => {
      if (bodyFrom < view.bodyStart) return;
      const end = contentEnd(source, bodyFrom, bodyTo);
      if (end <= bodyFrom) return;
      const tail = source.slice(Math.max(bodyFrom, end - 12), end);
      if (/[.,;:!?][\s}]*$/.test(tail) || /\\(?:quad|qquad)\s*$/.test(tail)) return;
      const after = source.slice(closeTo, closeTo + 80);
      if (/^\s*[.,;:]/.test(after)) return;
      const continues = /^[ \t]*(?:\n[ \t]*)?(?:[a-z]|\\(?:text|emph)\b)/.test(after) && !/^\s*\n\s*\n/.test(after);
      const mark = continues ? "," : ".";
      out.push(writingFinding(displayMathPunctuation.id, view, closeFrom, closeTo, {
        fix: fix(continues ? "fixes.addComma" : "fixes.addPeriod", [{ from: end, to: end, insert: mark }]),
        fingerprint: writingFingerprint(displayMathPunctuation.id, source.slice(Math.max(bodyFrom, end - 40), end)),
      }));
    };
    environments(source, [...DISPLAY_MATH_ENVIRONMENTS].filter((name) => name !== "math"), (_begin, bodyFrom, bodyTo, end) => {
      check(bodyFrom, bodyTo, bodyTo, end);
    });
    eachDisplayMath(source, (from, to) => {
      check(from + 2, to - 2, to - 2, to);
    });
    return capped(out);
  },
};

function firstIndex(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  return match ? match.index : -1;
}

function captionCount(text: string): number {
  return (text.match(/\\caption\s*[[{]/g) ?? []).length;
}

const tableCaptionBelow: WritingRule = {
  id: "writing-table-caption-below",
  profiles: EVERY,
  run: ({ view, source }) => {
    const out: Finding[] = [];
    environments(source, ["table", "table*"], (_begin, bodyFrom, bodyTo) => {
      const body = source.slice(bodyFrom, bodyTo);
      if (captionCount(body) !== 1 || /\\begin\s*\{(?:subtable|minipage)\}|\\subfloat\b/.test(body)) return;
      const caption = firstIndex(body, /\\caption\s*[[{]/);
      const lastEnd = body.search(/\\end\s*\{(?:tabular\*?|tabularx|tabulary|longtable|tblr|NiceTabular)\}(?![\s\S]*\\end\s*\{(?:tabular\*?|tabularx|tabulary|longtable|tblr|NiceTabular)\})/);
      if (caption < 0 || lastEnd < 0 || caption < lastEnd) return;
      const from = bodyFrom + caption;
      out.push(writingFinding(tableCaptionBelow.id, view, from, from + "\\caption".length));
    });
    return capped(out);
  },
};

const figureCaptionAbove: WritingRule = {
  id: "writing-figure-caption-above",
  profiles: EVERY,
  run: ({ view, source }) => {
    const out: Finding[] = [];
    environments(source, ["figure", "figure*"], (_begin, bodyFrom, bodyTo) => {
      const body = source.slice(bodyFrom, bodyTo);
      if (captionCount(body) !== 1 || /\\begin\s*\{(?:subfigure|minipage|tabular)\}|\\subfloat\b/.test(body)) return;
      const caption = firstIndex(body, /\\caption\s*[[{]/);
      const graphic = firstIndex(body, /\\(?:includegraphics|includesvg|input|begin\s*\{tikzpicture\})/);
      if (caption < 0 || graphic < 0 || caption > graphic) return;
      const from = bodyFrom + caption;
      out.push(writingFinding(figureCaptionAbove.id, view, from, from + "\\caption".length));
    });
    return capped(out);
  },
};

export function macroReplacement(macro: MacroText, next: string | undefined): string {
  if (macro.spacing === "xspace") return `\\${macro.name}`;
  return next !== undefined && /[\sA-Za-z0-9]/.test(next) ? `\\${macro.name}{}` : `\\${macro.name}`;
}

const macroAvailable: WritingRule = {
  id: "writing-macro-available",
  profiles: EVERY,
  run: ({ view, macros }) => {
    const out: Finding[] = [];
    for (const macro of macros) {
      const lead = /^[A-Za-z0-9]/.test(macro.text) ? "(?<![A-Za-z0-9\\\\])" : "";
      const tail = /[A-Za-z0-9]$/.test(macro.text) ? "(?![A-Za-z0-9])" : "";
      each(new RegExp(`${lead}${escapeRegExp(macro.text)}${tail}`, "g"), view.text, (match) => {
        const from = match.index;
        const to = from + match[0].length;
        if (!isProse(view, from, to)) return;
        const insert = macroReplacement(macro, view.text[to]);
        out.push(writingFinding(macroAvailable.id, view, from, to, {
          fix: fix("fixes.useMacro", [{ from, to, insert }], { macro: `\\${macro.name}` }),
          detail: message("rules.writing-macro-available.detail", { text: macro.text, macro: `\\${macro.name}` }),
        }));
      });
    }
    return capped(out);
  },
};

const UNNUMBERED = ["equation*", "align*", "gather*", "multline*", "flalign*", "displaymath"] as const;

const unnumberedEquation: WritingRule = {
  id: "writing-unnumbered-equation",
  profiles: CVPR,
  run: ({ view, source }) => {
    const out: Finding[] = [];
    environments(source, UNNUMBERED, (begin, bodyFrom, bodyTo, end, name) => {
      if (begin < view.bodyStart) return;
      const numbered = name === "displaymath" ? "equation" : name.slice(0, -1);
      const openTo = bodyFrom;
      const closeFrom = bodyTo;
      out.push(writingFinding(unnumberedEquation.id, view, begin, openTo, {
        fix: fix("fixes.numberEquation", [
          { from: begin, to: openTo, insert: `\\begin{${numbered}}` },
          { from: closeFrom, to: end, insert: `\\end{${numbered}}` },
        ]),
      }));
    });
    eachDisplayMath(source, (from, to, body) => {
      if (from < view.bodyStart) return;
      out.push(writingFinding(unnumberedEquation.id, view, from, from + 2, {
        fix: fix("fixes.numberEquation", [
          { from, to: from + 2, insert: "\\begin{equation}" },
          { from: to - 2, to, insert: "\\end{equation}" },
        ]),
        fingerprint: writingFingerprint(unnumberedEquation.id, body),
      }));
    });
    return capped(out);
  },
};

const floatPlacement: WritingRule = {
  id: "writing-float-placement",
  profiles: CVPR,
  run: ({ view, source }) => {
    const out: Finding[] = [];
    each(/\\begin\s*\{(?:figure|table)\*?\}\s*\[([^\][\n]{0,40})\]/g, source, (match) => {
      if (match.index < view.bodyStart) return;
      const options = match[1];
      if (!/[hH]/.test(options) || /t/.test(options)) return;
      const open = match.index + match[0].lastIndexOf("[");
      const close = match.index + match[0].length;
      out.push(writingFinding(floatPlacement.id, view, open, close, {
        fix: fix("fixes.placeTop", [{ from: open, to: close, insert: "[t]" }]),
      }));
    });
    return capped(out);
  },
};

export const BUILT_IN_WRITING_RULES: readonly WritingRule[] = [
  spaceBeforeParen,
  spaceBeforePunctuation,
  nonbreakingReference,
  straightQuotes,
  citeInAbstract,
  abbreviationAtSentenceStart,
  displayMathPunctuation,
  tableCaptionBelow,
  figureCaptionAbove,
  macroAvailable,
  tableAbbreviation,
  unnumberedEquation,
  floatPlacement,
];

export function rulesForProfile(profile: ResolvedWritingProfile): readonly WritingRule[] {
  return BUILT_IN_WRITING_RULES.filter((rule) => rule.profiles.includes(profile));
}

export function customRulePattern(rule: Pick<CustomWritingRule, "find" | "wholeWord" | "caseSensitive">): RegExp {
  const lead = rule.wholeWord && /^[A-Za-z0-9]/.test(rule.find) ? "(?<![A-Za-z0-9])" : "";
  const tail = rule.wholeWord && /[A-Za-z0-9]$/.test(rule.find) ? "(?![A-Za-z0-9])" : "";
  return new RegExp(`${lead}${escapeRegExp(rule.find)}${tail}`, rule.caseSensitive ? "g" : "gi");
}

export function customRuleMatches(view: ProseView, rule: Pick<CustomWritingRule, "find" | "wholeWord" | "caseSensitive">): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  each(customRulePattern(rule), view.text, (match) => {
    const from = match.index;
    const to = from + match[0].length;
    if (isProse(view, from, to)) out.push({ from, to });
  });
  return out.slice(0, PER_RULE_LIMIT);
}

export function customRuleFindings(view: ProseView, rules: readonly CustomWritingRule[]): Finding[] {
  const out: Finding[] = [];
  for (const rule of rules) {
    for (const { from, to } of customRuleMatches(view, rule)) {
      const matched = view.text.slice(from, to);
      const params = { find: rule.find, replace: rule.replace ?? "", note: rule.note ?? "" };
      const detailKey: PreflightMessageKey = rule.note
        ? "rules.writing-custom.detailNote"
        : rule.replace === null
          ? "rules.writing-custom.detailFlag"
          : "rules.writing-custom.detail";
      out.push(writingFinding("writing-custom", view, from, to, {
        title: message("rules.writing-custom.title", { find: rule.find }),
        detail: message(detailKey, params),
        fingerprint: writingFingerprint(`writing-custom:${rule.id}`, matched),
        ...(rule.replace !== null && rule.replace !== matched
          ? { fix: fix("fixes.replaceWith", [{ from, to, insert: rule.replace }], { text: rule.replace }) }
          : {}),
      }));
    }
  }
  return out;
}


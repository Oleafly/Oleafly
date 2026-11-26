import type { Helper, RegexTransform } from "./types";

const WORD_SPLIT = /[^\p{L}\p{M}\p{N}]+/u;
const NOT_WORD = /[^\p{L}\p{M}\p{N}]+/gu;
const REGEX_FLAGS = /^[gimsu]*$/;

function words(value: string): string[] {
  return value.split(WORD_SPLIT).filter((word) => word.length > 0);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function camelWords(value: string): string[] {
  return value.split(/[-_\s]+/u).filter((word) => word.length > 0);
}

export function applyHelper(helper: Helper, value: string): string {
  switch (helper) {
    case "slug":
      return value.toLowerCase().replace(NOT_WORD, "-").replace(/^-+|-+$/gu, "");
    case "lower":
      return value.toLowerCase();
    case "upper":
      return value.toUpperCase();
    case "title":
      return value.replace(/(^|\s)(\S)/gu, (_match, space: string, first: string) => space + first.toUpperCase());
    case "initials":
      return words(value)
        .map((word) => Array.from(word)[0])
        .join("")
        .toUpperCase();
  }
}

export function validRegexTransform(transform: RegexTransform): boolean {
  if (!REGEX_FLAGS.test(transform.flags)) return false;
  try {
    new RegExp(transform.source, transform.flags);
    return true;
  } catch {
    return false;
  }
}

type Groups = readonly (string | undefined)[];

function caseChange(value: string, change: string): string {
  switch (change) {
    case "upcase":
      return value.toUpperCase();
    case "downcase":
      return value.toLowerCase();
    case "capitalize":
      return capitalize(value);
    case "camelcase": {
      const [first = "", ...rest] = camelWords(value);
      return first.charAt(0).toLowerCase() + first.slice(1) + rest.map(capitalize).join("");
    }
    case "pascalcase":
      return camelWords(value).map(capitalize).join("");
    default:
      return value;
  }
}

function conditional(value: string, rest: string): string {
  if (rest.startsWith("/")) return caseChange(value, rest.slice(1));
  if (rest.startsWith("+")) return value ? rest.slice(1) : "";
  if (rest.startsWith("?")) {
    const colon = rest.indexOf(":");
    const ifText = colon < 0 ? rest.slice(1) : rest.slice(1, colon);
    const elseText = colon < 0 ? "" : rest.slice(colon + 1);
    return value ? ifText : elseText;
  }
  const elseText = rest.startsWith("-") ? rest.slice(1) : rest;
  return value || elseText;
}

const FORMAT_ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t" };

function expandFormat(format: string, groups: Groups): string {
  let out = "";
  let index = 0;
  while (index < format.length) {
    const char = format[index];
    if (char === "\\" && index + 1 < format.length) {
      const next = format[index + 1];
      out += FORMAT_ESCAPES[next] ?? next;
      index += 2;
      continue;
    }
    if (char === "$") {
      const bare = /^\$(\d+)/u.exec(format.slice(index));
      if (bare) {
        out += groups[Number(bare[1])] ?? "";
        index += bare[0].length;
        continue;
      }
      const braced = /^\$\{(\d+)(?::((?:\\.|[^}])*))?\}/u.exec(format.slice(index));
      if (braced) {
        const value = groups[Number(braced[1])] ?? "";
        out += braced[2] === undefined ? value : conditional(value, braced[2].replace(/\\(.)/gu, "$1"));
        index += braced[0].length;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}

export function applyRegexTransform(value: string, transform: RegexTransform): string {
  if (!validRegexTransform(transform)) return value;
  const pattern = new RegExp(transform.source, transform.flags);
  return value.replace(pattern, (...args: unknown[]) => {
    const tail = typeof args.at(-1) === "object" ? 3 : 2;
    return expandFormat(transform.format, args.slice(0, args.length - tail) as Groups);
  });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DATE_TOKEN = /YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm|ss/gu;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDate(now: Date, format: string): string {
  return format.replace(DATE_TOKEN, (token) => {
    switch (token) {
      case "YYYY":
        return String(now.getFullYear());
      case "YY":
        return pad(now.getFullYear() % 100);
      case "MMMM":
        return MONTHS[now.getMonth()];
      case "MMM":
        return MONTHS[now.getMonth()].slice(0, 3);
      case "MM":
        return pad(now.getMonth() + 1);
      case "M":
        return String(now.getMonth() + 1);
      case "DD":
        return pad(now.getDate());
      case "D":
        return String(now.getDate());
      case "dddd":
        return DAYS[now.getDay()];
      case "ddd":
        return DAYS[now.getDay()].slice(0, 3);
      case "HH":
        return pad(now.getHours());
      case "mm":
        return pad(now.getMinutes());
      default:
        return pad(now.getSeconds());
    }
  });
}

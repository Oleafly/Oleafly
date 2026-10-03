import { maskComments } from "@/lib/index/parse-file";
import {
  composeSettingSteps,
  lineEndOf,
  removeRange,
  type DocumentSettingChanges,
  type DocumentSettingState,
  type DocumentSettingsEdit,
  type SettingsStep,
} from "./document-settings";

export type LatexSettingKey =
  | "paper"
  | "fontSize"
  | "columns"
  | "margin"
  | "font"
  | "lang"
  | "lineSpacing"
  | "secnumdepth"
  | "equationNumbering";

export const LATEX_SETTING_KEYS: readonly LatexSettingKey[] = [
  "paper",
  "fontSize",
  "columns",
  "margin",
  "font",
  "lang",
  "lineSpacing",
  "secnumdepth",
  "equationNumbering",
];

export type LatexLockReason = "class" | "package" | "engine" | "expression" | "sides" | "conditional";

export type LatexSettingChanges = DocumentSettingChanges<LatexSettingKey>;

export interface LatexEnvironment {
  readonly unicodeFonts: boolean;
}

export interface LatexDocumentSettings {
  fields: Record<LatexSettingKey, DocumentSettingState>;
  documentClass: string | null;
  lockingClass: string | null;
  layoutStyle: string | null;
  externalPreamble: boolean;
}

interface Span {
  from: number;
  to: number;
}

interface OptionItem extends Span {
  text: string;
}

interface OptionList {
  kind: "bracket" | "brace";
  open: number;
  close: number;
  items: OptionItem[];
}

interface Command {
  name: string;
  from: number;
  nameEnd: number;
  to: number;
  options: OptionList | null;
  args: Span[];
  conditional: boolean;
}

interface PackageUse {
  command: Command;
  names: string[];
}

interface Preamble {
  text: string;
  masked: string;
  docClass: Command | null;
  className: string | null;
  commands: Command[];
  packages: PackageUse[];
  external: boolean;
}

interface CommandSpec {
  options?: boolean;
  args: number;
  trailing?: boolean;
}

const COMMANDS: Record<string, CommandSpec> = {
  documentclass: { options: true, args: 1 },
  usepackage: { options: true, args: 1 },
  RequirePackage: { options: true, args: 1 },
  geometry: { args: 1 },
  setmainfont: { options: true, args: 1, trailing: true },
  setdefaultlanguage: { options: true, args: 1 },
  setmainlanguage: { options: true, args: 1 },
  singlespacing: { args: 0 },
  onehalfspacing: { args: 0 },
  doublespacing: { args: 0 },
  setstretch: { args: 1 },
  linespread: { args: 1 },
  setcounter: { args: 2 },
  numberwithin: { args: 2 },
  counterwithin: { args: 2 },
  input: { args: 1 },
  include: { args: 1 },
};

const SKIP_AFTER: Record<string, number> = {
  newif: 1,
  def: 1,
  gdef: 1,
  edef: 1,
  xdef: 1,
  newcommand: 1,
  renewcommand: 1,
  providecommand: 1,
  DeclareRobustCommand: 1,
  NewDocumentCommand: 1,
  RenewDocumentCommand: 1,
  let: 2,
};

const SETTING_COMMANDS = new Set([
  "geometry",
  "setmainfont",
  "setdefaultlanguage",
  "setmainlanguage",
  "singlespacing",
  "onehalfspacing",
  "doublespacing",
  "setstretch",
  "linespread",
  "setcounter",
  "numberwithin",
  "counterwithin",
]);

const CLASS_LOCKS: Record<string, readonly LatexSettingKey[]> = {
  beamer: ["paper", "columns", "margin", "lineSpacing", "secnumdepth", "equationNumbering"],
  ctexbeamer: ["paper", "columns", "margin", "lineSpacing", "secnumdepth", "equationNumbering", "lang"],
  acmart: ["paper", "fontSize", "columns", "margin", "font", "lineSpacing"],
  ieeetran: ["margin"],
  llncs: ["fontSize", "margin"],
  "revtex4-1": ["margin"],
  "revtex4-2": ["margin"],
  svjour3: ["margin"],
  "sn-jnl": ["margin"],
  ctexart: ["lang"],
  ctexrep: ["lang"],
  ctexbook: ["lang"],
};

const STYLE_LOCKS: readonly LatexSettingKey[] = ["paper", "margin"];
const LAYOUT_STYLE =
  /^(?:neurips|nips|icml|iclr|cvpr|iccv|eccv|wacv|aaai|acl|naacl|emnlp|coling|ijcai|colm|tmlr|jmlr|corl|aistats|uai|interspeech|fullpage|a4wide)/iu;

const PAPER_FLAG = /^(?:a[0-6]|b[0-6]|c[0-6]|letter|legal|executive)paper$/u;
const FONT_SIZE = /^\d{1,2}(?:\.\d+)?pt$/u;
const LATEX_LENGTH = /^\d+(?:\.\d+)?(?:pt|mm|cm|in|em|ex|bp|pc)$/u;
const NUMBER = /^\d+(?:\.\d+)?$/u;
const SIDE_KEYS = new Set([
  "left",
  "right",
  "top",
  "bottom",
  "inner",
  "outer",
  "hmargin",
  "vmargin",
  "lmargin",
  "rmargin",
  "tmargin",
  "bmargin",
  "textwidth",
  "textheight",
  "width",
  "height",
  "total",
  "body",
  "text",
  "scale",
  "hscale",
  "vscale",
  "marginratio",
  "hmarginratio",
  "vmarginratio",
]);
const SPACING: Record<string, string> = {
  singlespacing: "single",
  onehalfspacing: "onehalf",
  doublespacing: "double",
};
const SPACING_VALUES = new Set(Object.values(SPACING));
const NUMBERED_WITHIN = new Set(["part", "chapter", "section", "subsection"]);
const BABEL_FLAGS = new Set([
  "activeacute",
  "activegrave",
  "keepshorthandsactive",
  "noconfigs",
  "showlanguages",
  "silent",
  "base",
  "nocase",
  "safe",
  "math",
  "bidi",
  "layout",
  "strings",
  "hyphenmap",
]);
const LANGUAGES = new Set([
  "english",
  "american",
  "british",
  "usenglish",
  "ukenglish",
  "canadian",
  "australian",
  "newzealand",
  "german",
  "ngerman",
  "austrian",
  "naustrian",
  "swissgerman",
  "nswissgerman",
  "french",
  "francais",
  "acadian",
  "spanish",
  "catalan",
  "galician",
  "basque",
  "italian",
  "portuguese",
  "portuges",
  "brazilian",
  "brazil",
  "dutch",
  "afrikaans",
  "swedish",
  "danish",
  "norsk",
  "nynorsk",
  "norwegian",
  "finnish",
  "icelandic",
  "estonian",
  "latvian",
  "lithuanian",
  "polish",
  "czech",
  "slovak",
  "slovene",
  "croatian",
  "serbian",
  "russian",
  "ukrainian",
  "bulgarian",
  "greek",
  "turkish",
  "hungarian",
  "magyar",
  "romanian",
  "irish",
  "welsh",
  "scottish",
  "hebrew",
  "indonesian",
  "malay",
  "vietnamese",
  "latin",
  "esperanto",
]);

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

const isLetter = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z]/u.test(character);
const isSpace = (character: string | undefined): boolean =>
  character !== undefined && /\s/u.test(character);

function skipSpace(masked: string, pos: number): number {
  let cursor = pos;
  while (isSpace(masked[cursor])) cursor += 1;
  return cursor;
}

function braceEnd(masked: string, open: number): number {
  let depth = 0;
  for (let index = open; index < masked.length; index++) {
    const character = masked[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function bracketEnd(masked: string, open: number): number {
  let depth = 0;
  for (let index = open + 1; index < masked.length; index++) {
    const character = masked[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "]" && depth === 0) return index;
  }
  return -1;
}

function splitItems(masked: string, from: number, to: number): OptionItem[] {
  const items: OptionItem[] = [];
  let depth = 0;
  let start = from;
  const push = (end: number) => {
    let left = start;
    let right = end;
    while (left < right && isSpace(masked[left])) left += 1;
    while (right > left && isSpace(masked[right - 1])) right -= 1;
    if (right > left) items.push({ from: left, to: right, text: masked.slice(left, right) });
  };
  for (let index = from; index < to; index++) {
    const character = masked[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "," && depth === 0) {
      push(index);
      start = index + 1;
    }
  }
  push(to);
  return items;
}

function parseCommand(masked: string, from: number, name: string, nameEnd: number, spec: CommandSpec): Command | null {
  let pos = masked[nameEnd] === "*" ? nameEnd + 1 : nameEnd;
  const afterName = pos;
  let cursor = skipSpace(masked, pos);
  let options: OptionList | null = null;
  if (spec.options && masked[cursor] === "[") {
    const close = bracketEnd(masked, cursor);
    if (close < 0) return null;
    options = { kind: "bracket", open: cursor, close, items: splitItems(masked, cursor + 1, close) };
    pos = close + 1;
    cursor = skipSpace(masked, pos);
  }
  const args: Span[] = [];
  for (let count = 0; count < spec.args && masked[cursor] === "{"; count++) {
    const close = braceEnd(masked, cursor);
    if (close < 0) return null;
    args.push({ from: cursor + 1, to: close });
    pos = close + 1;
    cursor = skipSpace(masked, pos);
  }
  if (spec.trailing && args.length === spec.args && masked[cursor] === "[") {
    const close = bracketEnd(masked, cursor);
    if (close >= 0) pos = close + 1;
  }
  return { name, from, nameEnd: afterName, to: pos, options, args, conditional: false };
}

function startsConditional(masked: string, name: string, nameEnd: number): boolean {
  if (!name.startsWith("if")) return false;
  return masked[skipSpace(masked, nameEnd)] !== "{";
}

function scanPreamble(text: string): Preamble {
  const masked = maskComments(text);
  const begin = /\\begin\s*\{document\}/u.exec(masked);
  const end = begin ? begin.index : masked.length;
  const commands: Command[] = [];
  let depth = 0;
  let conditionals = 0;
  let skip = 0;
  for (let index = 0; index < end; index++) {
    const character = masked[index];
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character !== "\\") continue;
    let nameEnd = index + 1;
    while (nameEnd < end && isLetter(masked[nameEnd])) nameEnd += 1;
    if (nameEnd === index + 1) {
      index += 1;
      if (skip > 0) skip -= 1;
      continue;
    }
    const name = masked.slice(index + 1, nameEnd);
    index = nameEnd - 1;
    if (skip > 0) {
      skip -= 1;
      continue;
    }
    const skipCount = own(SKIP_AFTER, name);
    if (skipCount) {
      skip = skipCount;
      continue;
    }
    if (depth > 0) continue;
    if (startsConditional(masked, name, nameEnd)) {
      conditionals += 1;
      continue;
    }
    if (name === "fi") {
      conditionals = Math.max(0, conditionals - 1);
      continue;
    }
    const spec = own(COMMANDS, name);
    if (!spec) continue;
    const command = parseCommand(masked, index - name.length, name, nameEnd, spec);
    if (!command || command.to > end) continue;
    command.conditional = conditionals > 0;
    commands.push(command);
    index = command.to - 1;
  }
  const docClass = commands.find((command) => command.name === "documentclass" && command.args.length === 1) ?? null;
  const packages = commands
    .filter((command) => (command.name === "usepackage" || command.name === "RequirePackage") && command.args.length === 1)
    .map((command) => ({
      command,
      names: splitItems(masked, command.args[0].from, command.args[0].to).map((item) => item.text),
    }));
  return {
    text,
    masked,
    docClass,
    className: docClass ? argText(masked, docClass, 0) : null,
    commands,
    packages,
    external: commands.some((command) => command.name === "input" || command.name === "include"),
  };
}

function argText(masked: string, command: Command, index: number): string {
  const arg = command.args[index];
  return arg ? masked.slice(arg.from, arg.to).trim() : "";
}

function keyValue(item: OptionItem): { key: string; value: string; valueFrom: number } | null {
  const equals = item.text.indexOf("=");
  if (equals < 0) return null;
  let valueStart = equals + 1;
  while (isSpace(item.text[valueStart])) valueStart += 1;
  return {
    key: item.text.slice(0, equals).trim().toLowerCase(),
    value: item.text.slice(valueStart).trim(),
    valueFrom: item.from + valueStart,
  };
}

function braceList(masked: string, arg: Span): OptionList {
  return { kind: "brace", open: arg.from - 1, close: arg.to, items: splitItems(masked, arg.from, arg.to) };
}

function loads(p: Preamble, ...names: string[]): PackageUse | undefined {
  return p.packages.filter((pkg) => pkg.names.some((name) => names.includes(name))).at(-1);
}

function classKey(p: Preamble): string {
  return (p.className ?? "").toLowerCase();
}

function lockedBy(p: Preamble, key: LatexSettingKey): { reason: "class" | "package"; owner: string } | null {
  const locks = own(CLASS_LOCKS, classKey(p));
  if (p.className && locks?.includes(key)) return { reason: "class", owner: p.className };
  const style = layoutStyle(p);
  if (style && STYLE_LOCKS.includes(key)) return { reason: "package", owner: style };
  return null;
}

function layoutStyle(p: Preamble): string | null {
  for (const pkg of p.packages) {
    const name = pkg.names.find((candidate) => LAYOUT_STYLE.test(candidate));
    if (name) return name;
  }
  return null;
}

interface OptionRef {
  list: OptionList;
  item: OptionItem;
  command: Command;
  value: string;
  key: string | null;
}

function classOptionRefs(p: Preamble, match: (item: OptionItem) => { value: string; key: string | null } | null): OptionRef[] {
  const list = p.docClass?.options;
  if (!p.docClass || !list) return [];
  const refs: OptionRef[] = [];
  for (const item of list.items) {
    const found = match(item);
    if (found) refs.push({ list, item, command: p.docClass, ...found });
  }
  return refs;
}

function geometryLists(p: Preamble): { list: OptionList; command: Command }[] {
  const lists: { list: OptionList; command: Command }[] = [];
  for (const command of p.commands) {
    if (command.name === "geometry" && command.args.length === 1) {
      lists.push({ list: braceList(p.masked, command.args[0]), command });
    } else if (
      (command.name === "usepackage" || command.name === "RequirePackage") &&
      command.options &&
      p.packages.some((pkg) => pkg.command === command && pkg.names.includes("geometry"))
    ) {
      lists.push({ list: command.options, command });
    }
  }
  return lists;
}

function paperMatch(item: OptionItem): { value: string; key: string | null } | null {
  if (PAPER_FLAG.test(item.text)) return { value: item.text, key: null };
  const pair = keyValue(item);
  if (!pair || (pair.key !== "paper" && pair.key !== "papername")) return null;
  const value = pair.value.endsWith("paper") ? pair.value : `${pair.value}paper`;
  return PAPER_FLAG.test(value) ? { value, key: pair.key } : null;
}

function paperRefs(p: Preamble): OptionRef[] {
  const refs = classOptionRefs(p, paperMatch);
  for (const { list, command } of geometryLists(p)) {
    for (const item of list.items) {
      const found = paperMatch(item);
      if (found) refs.push({ list, item, command, ...found });
    }
  }
  return refs.sort((left, right) => left.item.from - right.item.from);
}

function fontSizeRefs(p: Preamble): OptionRef[] {
  return classOptionRefs(p, (item) => {
    if (FONT_SIZE.test(item.text)) return { value: item.text, key: null };
    const pair = keyValue(item);
    if (pair?.key !== "fontsize") return null;
    const value = NUMBER.test(pair.value) ? `${pair.value}pt` : pair.value;
    return FONT_SIZE.test(value) ? { value, key: pair.key } : null;
  });
}

function columnRefs(p: Preamble): OptionRef[] {
  return classOptionRefs(p, (item) =>
    item.text === "onecolumn" || item.text === "twocolumn" ? { value: item.text, key: null } : null,
  );
}

interface MarginRead {
  margin: OptionRef | null;
  sides: OptionItem[];
}

function marginRead(p: Preamble): MarginRead {
  let margin: OptionRef | null = null;
  const sides: OptionItem[] = [];
  for (const { list, command } of geometryLists(p)) {
    for (const item of list.items) {
      const pair = keyValue(item);
      if (!pair) continue;
      if (pair.key === "margin") margin = { list, item, command, value: pair.value, key: "margin" };
      else if (SIDE_KEYS.has(pair.key)) sides.push(item);
    }
  }
  return { margin, sides };
}

function lastCommand(p: Preamble, names: readonly string[], test?: (command: Command) => boolean): Command | undefined {
  return p.commands.filter((command) => names.includes(command.name) && (!test || test(command))).at(-1);
}

type LangRef =
  | { kind: "command"; command: Command; value: string }
  | { kind: "option"; ref: OptionRef; pkg: PackageUse | null };

function babelLanguage(item: OptionItem): { value: string; key: string | null } | null {
  const pair = keyValue(item);
  if (pair) return pair.key === "main" ? { value: pair.value, key: "main" } : null;
  return BABEL_FLAGS.has(item.text.toLowerCase()) ? null : { value: item.text, key: null };
}

function langRead(p: Preamble): LangRef | "unset" | "unknown" {
  const poly = lastCommand(p, ["setdefaultlanguage", "setmainlanguage"], (command) => command.args.length === 1);
  if (poly) return { kind: "command", command: poly, value: argText(p.masked, poly, 0) };
  const babel = loads(p, "babel");
  if (!babel) return "unset";
  const list = babel.command.options;
  if (list && list.items.length > 0) {
    let main: OptionRef | null = null;
    let last: OptionRef | null = null;
    for (const item of list.items) {
      const found = babelLanguage(item);
      if (!found) continue;
      const ref = { list, item, command: babel.command, ...found };
      if (found.key === "main") main = ref;
      else last = ref;
    }
    const chosen = main ?? last;
    return chosen ? { kind: "option", ref: chosen, pkg: babel } : "unknown";
  }
  const global = classOptionRefs(p, (item) =>
    LANGUAGES.has(item.text.toLowerCase()) ? { value: item.text, key: null } : null,
  ).at(-1);
  if (global) return { kind: "option", ref: global, pkg: null };
  return babel.names.length === 1 ? "unset" : "unknown";
}

type SpacingRef =
  | { kind: "option"; ref: OptionRef }
  | { kind: "command"; command: Command; value: string };

function spacingRead(p: Preamble): SpacingRef | null {
  const refs: { at: number; ref: SpacingRef }[] = [];
  const setspace = loads(p, "setspace");
  const list = setspace?.command.options;
  if (setspace && list) {
    for (const item of list.items) {
      const value = own(SPACING, item.text);
      if (value) refs.push({ at: item.from, ref: { kind: "option", ref: { list, item, command: setspace.command, value, key: null } } });
    }
  }
  for (const command of p.commands) {
    const named = own(SPACING, command.name);
    if (named) refs.push({ at: command.from, ref: { kind: "command", command, value: named } });
    else if ((command.name === "setstretch" || command.name === "linespread") && command.args.length === 1) {
      refs.push({ at: command.from, ref: { kind: "command", command, value: argText(p.masked, command, 0) } });
    }
  }
  return refs.sort((left, right) => left.at - right.at).at(-1)?.ref ?? null;
}

function secnumdepthCommand(p: Preamble): Command | undefined {
  return lastCommand(
    p,
    ["setcounter"],
    (command) => command.args.length === 2 && argText(p.masked, command, 0) === "secnumdepth",
  );
}

function equationCommand(p: Preamble): Command | undefined {
  return lastCommand(
    p,
    ["numberwithin", "counterwithin"],
    (command) => command.args.length === 2 && argText(p.masked, command, 0) === "equation",
  );
}

function fontCommand(p: Preamble): Command | undefined {
  return lastCommand(p, ["setmainfont"], (command) => command.args.length === 1);
}

const unset: DocumentSettingState = { status: "unset" };

function located(conditional: boolean, value: string, valid: boolean): DocumentSettingState {
  if (conditional) return { status: "locked", reason: "conditional", source: value };
  return valid ? { status: "set", value } : { status: "locked", reason: "expression", source: value };
}

function fromOption(ref: OptionRef | undefined): DocumentSettingState {
  return ref ? located(ref.command.conditional, ref.value, true) : unset;
}

function sourceValue(p: Preamble, key: LatexSettingKey): string {
  const state = rawField(p, key, { unicodeFonts: true });
  if (state.status === "set") return state.value;
  return state.status === "locked" ? state.source : "";
}

function rawField(p: Preamble, key: LatexSettingKey, env: LatexEnvironment): DocumentSettingState {
  switch (key) {
    case "paper":
      return fromOption(paperRefs(p).at(-1));
    case "fontSize":
      return fromOption(fontSizeRefs(p).at(-1));
    case "columns":
      return fromOption(columnRefs(p).at(-1));
    case "margin": {
      const { margin, sides } = marginRead(p);
      if (margin) return located(margin.command.conditional, margin.value, LATEX_LENGTH.test(margin.value));
      if (sides.length > 0) return { status: "locked", reason: "sides", source: sides.map((item) => item.text).join(",") };
      return unset;
    }
    case "font": {
      const command = fontCommand(p);
      const value = command ? argText(p.masked, command, 0) : "";
      if (!env.unicodeFonts) return { status: "locked", reason: "engine", source: value };
      return command ? located(command.conditional, value, !/[\\{}]/u.test(value)) : unset;
    }
    case "lang": {
      const read = langRead(p);
      if (read === "unset") return unset;
      if (read === "unknown") return { status: "locked", reason: "expression", source: "" };
      if (read.kind === "command") {
        return located(read.command.conditional, read.value, /^[A-Za-z][A-Za-z-]*$/u.test(read.value));
      }
      return fromOption(read.ref);
    }
    case "lineSpacing": {
      const read = spacingRead(p);
      if (!read) return unset;
      if (read.kind === "option") return fromOption(read.ref);
      return located(read.command.conditional, read.value, SPACING_VALUES.has(read.value) || NUMBER.test(read.value));
    }
    case "secnumdepth": {
      const command = secnumdepthCommand(p);
      if (!command) return unset;
      const value = argText(p.masked, command, 1);
      return located(command.conditional, value, /^-?\d+$/u.test(value));
    }
    case "equationNumbering": {
      const command = equationCommand(p);
      if (!command) return unset;
      const value = argText(p.masked, command, 1);
      return located(command.conditional, value, /^[A-Za-z]+$/u.test(value));
    }
  }
}

function fieldState(p: Preamble, key: LatexSettingKey, env: LatexEnvironment): DocumentSettingState {
  const lock = lockedBy(p, key);
  if (lock) return { status: "locked", reason: lock.reason, source: sourceValue(p, key), owner: lock.owner };
  return rawField(p, key, env);
}

export function readLatexDocumentSettings(text: string, env: LatexEnvironment): LatexDocumentSettings {
  const p = scanPreamble(text);
  const fields = Object.fromEntries(LATEX_SETTING_KEYS.map((key) => [key, fieldState(p, key, env)])) as Record<
    LatexSettingKey,
    DocumentSettingState
  >;
  const lockingClass = p.className && own(CLASS_LOCKS, classKey(p)) ? p.className : null;
  return {
    fields,
    documentClass: p.className,
    lockingClass,
    layoutStyle: layoutStyle(p),
    externalPreamble: p.external,
  };
}

export function validateLatexSetting(key: LatexSettingKey, value: string): boolean {
  const trimmed = value.trim();
  switch (key) {
    case "paper":
      return PAPER_FLAG.test(trimmed);
    case "fontSize":
      return FONT_SIZE.test(trimmed);
    case "columns":
      return trimmed === "onecolumn" || trimmed === "twocolumn";
    case "margin":
      return LATEX_LENGTH.test(trimmed);
    case "font":
      return trimmed.length > 0 && !/[\\{}%#$&^_~\n]/u.test(trimmed);
    case "lang":
      return /^[A-Za-z][A-Za-z-]*$/u.test(trimmed);
    case "lineSpacing":
      return SPACING_VALUES.has(trimmed) || /^\d(?:\.\d+)?$/u.test(trimmed);
    case "secnumdepth":
      return /^-?\d$/u.test(trimmed);
    case "equationNumbering":
      return NUMBERED_WITHIN.has(trimmed);
  }
}

export function latexSupportsSystemFonts(engine: string | undefined, flavor: string | null | undefined, text: string): boolean {
  if (engine !== "latexmk") return true;
  if (flavor) return flavor === "xelatex" || flavor === "lualatex";
  const head = text.split("\n").slice(0, 100).join("\n");
  const magic = /^\s*%\s*!*\s*tex\s+program\s*=\s*([A-Za-z]+)/imu.exec(head);
  if (magic) return /^(?:xelatex|lualatex)$/iu.test(magic[1]);
  return /fontspec|polyglossia|unicode-math|\\setmainfont/u.test(text);
}

function replaceItem(item: OptionItem, insert: string): DocumentSettingsEdit {
  return { from: item.from, to: item.to, insert };
}

function replaceValue(ref: OptionRef, value: string): DocumentSettingsEdit {
  const pair = keyValue(ref.item);
  if (!pair) return replaceItem(ref.item, value);
  return { from: pair.valueFrom, to: ref.item.to, insert: value };
}

function removeItem(text: string, ref: OptionRef): DocumentSettingsEdit {
  const { list, item, command } = ref;
  if (list.items.length === 1) {
    if (list.kind === "brace") return removeRange(text, command.from, command.to);
    return { from: list.open, to: list.close + 1, insert: "" };
  }
  const index = list.items.indexOf(item);
  if (index < list.items.length - 1) return { from: item.from, to: list.items[index + 1].from, insert: "" };
  return { from: list.items[index - 1].to, to: item.to, insert: "" };
}

function appendItem(text: string, list: OptionList | null, command: Command, insert: string): DocumentSettingsEdit {
  if (!list) return { from: command.nameEnd, to: command.nameEnd, insert: `[${insert}]` };
  const last = list.items.at(-1);
  if (!last) return { from: list.open + 1, to: list.close, insert };
  const [first, second] = list.items;
  const between = second ? text.slice(first.to, second.from) : ",";
  const separator = /^\s*,\s*$/u.test(between) ? between : ",";
  return { from: last.to, to: last.to, insert: `${separator}${insert}` };
}

function anchorEnd(p: Preamble, kind: "package" | "command"): number | null {
  const start = p.docClass?.from ?? -1;
  const usable = (command: Command) => !command.conditional && command.from > start;
  let end = p.packages.map((pkg) => pkg.command).filter(usable).at(-1)?.to ?? p.docClass?.to ?? null;
  if (end === null) return null;
  if (kind === "command") {
    for (const command of p.commands) {
      if (usable(command) && SETTING_COMMANDS.has(command.name) && command.to > end) end = command.to;
    }
  }
  return end;
}

function insertLines(p: Preamble, lines: readonly string[], kind: "package" | "command"): DocumentSettingsEdit[] {
  const anchor = anchorEnd(p, kind);
  if (anchor === null) return [];
  const at = lineEndOf(p.text, anchor);
  if (at >= p.text.length) return [{ from: at, to: at, insert: `\n${lines.join("\n")}` }];
  return [{ from: at + 1, to: at + 1, insert: lines.map((line) => `${line}\n`).join("") }];
}

function removeCommand(p: Preamble, command: Command): DocumentSettingsEdit {
  return removeRange(p.text, command.from, command.to);
}

function replaceArg(command: Command, index: number, insert: string): DocumentSettingsEdit {
  const arg = command.args[index];
  return { from: arg.from, to: arg.to, insert };
}

type Phase = "package" | "command";
type PlannedStep = readonly [Phase, SettingsStep];

const scanned = (step: (p: Preamble) => DocumentSettingsEdit[]): SettingsStep => (current) => {
  const p = scanPreamble(current);
  return p.docClass ? step(p) : [];
};

function ensurePackage(name: string, satisfied: (p: Preamble) => boolean): PlannedStep {
  return ["package", scanned((p) => (satisfied(p) ? [] : insertLines(p, [`\\usepackage{${name}}`], "package")))];
}

function hasSetspace(p: Preamble, before = Number.POSITIVE_INFINITY): boolean {
  if (classKey(p) === "memoir") return true;
  return p.packages.some((pkg) => pkg.names.includes("setspace") && pkg.command.to <= before);
}

function hasAmsmath(p: Preamble): boolean {
  return /^ams/u.test(classKey(p)) || !!loads(p, "amsmath", "mathtools");
}

function hasFontspec(p: Preamble): boolean {
  return classKey(p).startsWith("ctex") || !!loads(p, "fontspec", "unicode-math", "polyglossia", "xeCJK", "ctex");
}

function classOptionPlan(refsOf: (p: Preamble) => OptionRef[], value: string | null, serialize: (ref: OptionRef | null) => string): PlannedStep[] {
  if (value === null) {
    return Array.from({ length: 4 }, () => ["command", scanned((p) => {
      const last = refsOf(p).at(-1);
      return last ? [removeItem(p.text, last)] : [];
    })] as const);
  }
  return [["command", scanned((p) => {
    const last = refsOf(p).at(-1);
    if (last) return [replaceItem(last.item, serialize(last))];
    const docClass = p.docClass;
    return docClass ? [appendItem(p.text, docClass.options, docClass, serialize(null))] : [];
  })]];
}

function paperPlan(value: string | null): PlannedStep[] {
  return classOptionPlan(paperRefs, value, (ref) => {
    if (!value || !ref?.key) return value ?? "";
    const raw = keyValue(ref.item)?.value ?? "";
    return `${ref.key}=${ref.key === "paper" && !raw.endsWith("paper") ? value.replace(/paper$/u, "") : value}`;
  });
}

function fontSizePlan(value: string | null): PlannedStep[] {
  return classOptionPlan(fontSizeRefs, value, (ref) => (value && ref?.key ? `${ref.key}=${value}` : (value ?? "")));
}

function columnsPlan(value: string | null): PlannedStep[] {
  return classOptionPlan(columnRefs, value, () => value ?? "");
}

function marginPlan(value: string | null): PlannedStep[] {
  if (value === null) {
    return [["command", scanned((p) => {
      const { margin } = marginRead(p);
      if (!margin) return [];
      const sole = margin.list.items.length === 1 && margin.list.kind === "bracket";
      const pkg = p.packages.find((candidate) => candidate.command === margin.command);
      if (sole && pkg && pkg.names.length === 1) return [removeCommand(p, margin.command)];
      return [removeItem(p.text, margin)];
    })]];
  }
  return [["package", scanned((p) => {
    const { margin, sides } = marginRead(p);
    if (margin) return [replaceValue(margin, value)];
    if (sides.length > 0) return [];
    const call = lastCommand(p, ["geometry"], (command) => command.args.length === 1);
    if (call) return [appendItem(p.text, braceList(p.masked, call.args[0]), call, `margin=${value}`)];
    const pkg = loads(p, "geometry");
    if (pkg && pkg.names.length === 1) return [appendItem(p.text, pkg.command.options, pkg.command, `margin=${value}`)];
    if (pkg) return insertLines(p, [`\\geometry{margin=${value}}`], "command");
    if (p.external) return insertLines(p, ["\\usepackage{geometry}", `\\geometry{margin=${value}}`], "package");
    return insertLines(p, [`\\usepackage[margin=${value}]{geometry}`], "package");
  })]];
}

function fontPlan(value: string | null): PlannedStep[] {
  if (value === null) {
    return [["command", scanned((p) => {
      const command = fontCommand(p);
      return command ? [removeCommand(p, command)] : [];
    })]];
  }
  return [
    ensurePackage("fontspec", (p) => !!fontCommand(p) || hasFontspec(p)),
    ["command", scanned((p) => {
      const command = fontCommand(p);
      if (command) return [replaceArg(command, 0, value)];
      return insertLines(p, [`\\setmainfont{${value}}`], "command");
    })],
  ];
}

function langPlan(value: string | null): PlannedStep[] {
  return [[value === null ? "command" : "package", scanned((p) => {
    const read = langRead(p);
    if (read === "unknown") return [];
    if (value === null) {
      if (read === "unset") return [];
      if (read.kind === "command") return [removeCommand(p, read.command)];
      const { ref, pkg } = read;
      if (pkg && ref.list.items.length === 1 && pkg.names.length === 1) return [removeCommand(p, pkg.command)];
      return [removeItem(p.text, ref)];
    }
    if (read !== "unset") {
      if (read.kind === "command") return [replaceArg(read.command, 0, value)];
      return [read.ref.key === "main" ? replaceValue(read.ref, value) : replaceItem(read.ref.item, value)];
    }
    const babel = loads(p, "babel");
    if (babel) return [appendItem(p.text, babel.command.options, babel.command, value)];
    if (loads(p, "polyglossia")) return insertLines(p, [`\\setdefaultlanguage{${value}}`], "command");
    return insertLines(p, [`\\usepackage[${value}]{babel}`], "package");
  })]];
}

function spacingCommand(value: string): string {
  return `\\${Object.keys(SPACING).find((name) => SPACING[name] === value)}`;
}

function lineSpacingPlan(value: string | null): PlannedStep[] {
  if (value === null) {
    return [["command", scanned((p) => {
      const read = spacingRead(p);
      if (!read) return [];
      return [read.kind === "option" ? removeItem(p.text, read.ref) : removeCommand(p, read.command)];
    })]];
  }
  if (!SPACING_VALUES.has(value)) {
    const stretch = (p: Preamble) => (hasSetspace(p) ? `\\setstretch{${value}}` : `\\linespread{${value}}`);
    return [
      ["command", scanned((p) => {
        const read = spacingRead(p);
        if (!read) return [];
        if (read.kind === "option") return [removeItem(p.text, read.ref)];
        if (read.command.name === "setstretch" || read.command.name === "linespread") return [replaceArg(read.command, 0, value)];
        return [removeCommand(p, read.command)];
      })],
      ["command", scanned((p) => (spacingRead(p) ? [] : insertLines(p, [stretch(p)], "command")))],
    ];
  }
  const command = spacingCommand(value);
  return [
    ensurePackage("setspace", (p) => hasSetspace(p)),
    ["command", scanned((p) => {
      const read = spacingRead(p);
      if (read?.kind === "option") return [replaceItem(read.ref.item, `${value}spacing`)];
      if (read && hasSetspace(p, read.command.from)) return [{ from: read.command.from, to: read.command.to, insert: command }];
      if (read) return [removeCommand(p, read.command)];
      return insertLines(p, [command], "command");
    })],
    ["command", scanned((p) => (spacingRead(p) ? [] : insertLines(p, [command], "command")))],
  ];
}

function counterPlan(
  find: (p: Preamble) => Command | undefined,
  line: (value: string) => string,
  value: string | null,
  requirement?: PlannedStep,
): PlannedStep[] {
  if (value === null) {
    return [["command", scanned((p) => {
      const command = find(p);
      return command ? [removeCommand(p, command)] : [];
    })]];
  }
  const write: PlannedStep = ["command", scanned((p) => {
    const command = find(p);
    if (command) return [replaceArg(command, 1, value)];
    return insertLines(p, [line(value)], "command");
  })];
  return requirement ? [requirement, write] : [write];
}

function planFor(key: LatexSettingKey, value: string | null): PlannedStep[] {
  switch (key) {
    case "paper":
      return paperPlan(value);
    case "fontSize":
      return fontSizePlan(value);
    case "columns":
      return columnsPlan(value);
    case "margin":
      return marginPlan(value);
    case "font":
      return fontPlan(value);
    case "lang":
      return langPlan(value);
    case "lineSpacing":
      return lineSpacingPlan(value);
    case "secnumdepth":
      return counterPlan(secnumdepthCommand, (next) => `\\setcounter{secnumdepth}{${next}}`, value);
    case "equationNumbering":
      return counterPlan(
        equationCommand,
        (next) => `\\numberwithin{equation}{${next}}`,
        value,
        ensurePackage("amsmath", (p) => hasAmsmath(p) || !!equationCommand(p)),
      );
  }
}

export function latexSettingsEdits(text: string, changes: LatexSettingChanges, env: LatexEnvironment): DocumentSettingsEdit[] {
  const { fields, documentClass } = readLatexDocumentSettings(text, env);
  if (!documentClass) return [];
  const planned: PlannedStep[] = [];
  for (const key of LATEX_SETTING_KEYS) {
    if (!Object.hasOwn(changes, key)) continue;
    const current = fields[key];
    if (current.status === "locked") continue;
    const raw = changes[key];
    const next = raw === null || raw === undefined || raw.trim() === "" ? null : raw.trim();
    if (next === null && current.status === "unset") continue;
    if (next !== null && (!validateLatexSetting(key, next) || (current.status === "set" && current.value === next))) continue;
    planned.push(...planFor(key, next));
  }
  const ordered = [
    ...planned.filter(([phase]) => phase === "package"),
    ...planned.filter(([phase]) => phase === "command"),
  ].map(([, step]) => step);
  return composeSettingSteps(text, ordered);
}

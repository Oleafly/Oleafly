import { KNOWN_VARIABLES } from "./body";
import { applyRegexTransform, formatDate, mirrorText } from "./helpers";
import type { BodyNode, Helper, ProjectFieldKind, RegexTransform } from "./types";

export interface RenderEnv {
  selection: string;
  clipboard: string;
  now: Date;
  fileName: string | null;
  projectName: string | null;
  lineComment: string;
  captures: string[];
  indent: string;
  indentUnit: string;
}

export interface FieldSpec {
  index: number;
  ranges: { from: number; to: number }[];
  choices?: string[];
  project?: ProjectFieldKind;
}

export interface MirrorSpec {
  source: number;
  from: number;
  to: number;
  helper?: Helper;
  regex?: RegexTransform;
}

export interface Rendered {
  text: string;
  fields: FieldSpec[];
  mirrors: MirrorSpec[];
  exit: number;
}

const DATE_VARIABLES: Readonly<Record<string, string>> = {
  CURRENT_YEAR: "YYYY",
  CURRENT_YEAR_SHORT: "YY",
  CURRENT_MONTH: "MM",
  CURRENT_MONTH_NAME: "MMMM",
  CURRENT_MONTH_NAME_SHORT: "MMM",
  CURRENT_DATE: "DD",
  CURRENT_DAY_NAME: "dddd",
  CURRENT_DAY_NAME_SHORT: "ddd",
  CURRENT_HOUR: "HH",
  CURRENT_MINUTE: "mm",
  CURRENT_SECOND: "ss",
};

function baseName(fileName: string | null): string {
  return fileName?.split(/[\\/]/u).at(-1) ?? "";
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function randomDigits(): string {
  const bytes = new Uint8Array(16);
  let digits = "";
  while (digits.length < 6) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      for (const nibble of [byte & 0x0f, byte >> 4]) {
        if (nibble < 10 && digits.length < 6) digits += String(nibble);
      }
    }
  }
  return digits;
}

function variableValue(name: string, format: string | undefined, env: RenderEnv): string {
  const dateFormat = DATE_VARIABLES[name];
  if (dateFormat) return formatDate(env.now, dateFormat);
  switch (name) {
    case "TM_FILENAME":
      return baseName(env.fileName);
    case "TM_FILENAME_BASE":
      return withoutExtension(baseName(env.fileName));
    case "CLIPBOARD":
      return env.clipboard;
    case "LINE_COMMENT":
      return env.lineComment;
    case "SELECTION":
      return env.selection;
    case "UUID":
      return crypto.randomUUID();
    case "RANDOM":
      return randomDigits();
    case "DATE":
      return formatDate(env.now, format ?? "YYYY-MM-DD");
    default:
      return env.projectName ?? "";
  }
}

type Variable = Extract<BodyNode, { kind: "variable" }>;

class Emitter {
  text = "";
  readonly fields = new Map<number, FieldSpec>();
  readonly mirrors: MirrorSpec[] = [];
  readonly fieldTexts = new Map<number, string>();

  constructor(
    private readonly env: RenderEnv,
    private readonly earlier: ReadonlyMap<number, string>,
    private readonly variable: (node: Variable) => string,
  ) {}

  private push(value: string): void {
    this.text += value;
  }

  private pushIndented(value: string): void {
    this.push(value.replaceAll("\t", this.env.indentUnit).replaceAll("\n", `\n${this.env.indent}`));
  }

  private addField(index: number, from: number, extra: Omit<FieldSpec, "index" | "ranges">): void {
    const existing = this.fields.get(index);
    if (existing) {
      existing.ranges.push({ from, to: this.text.length });
      return;
    }
    this.fields.set(index, { index, ranges: [{ from, to: this.text.length }], ...extra });
    this.fieldTexts.set(index, this.text.slice(from));
  }

  emit(nodes: readonly BodyNode[]): void {
    for (const node of nodes) {
      const from = this.text.length;
      switch (node.kind) {
        case "text":
          this.pushIndented(node.text);
          break;
        case "field":
          this.emit(node.placeholder);
          this.addField(node.index, from, {});
          break;
        case "choice":
          this.pushIndented(node.options[0] ?? "");
          this.addField(node.index, from, { choices: node.options });
          break;
        case "project":
          this.pushIndented(node.placeholder);
          this.addField(node.index, from, { project: node.field });
          break;
        case "mirror": {
          const source = this.fieldTexts.get(node.index) ?? this.earlier.get(node.index) ?? "";
          const value = mirrorText(source, node);
          this.push(value);
          this.mirrors.push({
            source: node.index,
            from,
            to: this.text.length,
            ...(node.helper ? { helper: node.helper } : {}),
            ...(node.regex ? { regex: node.regex } : {}),
          });
          break;
        }
        case "variable": {
          const value = this.variable(node);
          if (value) this.push(value);
          else if (node.fallback.length > 0) this.emit(node.fallback);
          else if (!KNOWN_VARIABLES.has(node.name)) this.push(node.name);
          break;
        }
        case "capture":
          this.push(this.env.captures[node.group - 1] ?? "");
          break;
      }
    }
  }
}

function fieldOrder(a: FieldSpec, b: FieldSpec): number {
  if (a.index === 0) return 1;
  if (b.index === 0) return -1;
  return a.index - b.index;
}

export function renderBody(nodes: BodyNode[], env: RenderEnv): Rendered {
  const values = new Map<string, string>();
  const variable = (node: Variable): string => {
    if (!KNOWN_VARIABLES.has(node.name)) return "";
    const key = `${node.name}\u0000${node.format ?? ""}`;
    let value = values.get(key);
    if (value === undefined) {
      value = variableValue(node.name, node.format, env);
      values.set(key, value);
    }
    return node.regex ? applyRegexTransform(value, node.regex) : value;
  };
  const first = new Emitter(env, new Map(), variable);
  first.emit(nodes);
  const emitter = new Emitter(env, first.fieldTexts, variable);
  emitter.emit(nodes);
  const fields = [...emitter.fields.values()].sort(fieldOrder);
  const exitField = emitter.fields.get(0);
  return {
    text: emitter.text,
    fields,
    mirrors: emitter.mirrors,
    exit: exitField ? exitField.ranges[0].from : emitter.text.length,
  };
}

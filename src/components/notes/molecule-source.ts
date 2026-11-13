import { dataUrlText, type NoteFile, parseOptionLine, splitBlockOptions } from "./note-blocks";
import { notePath } from "./note-path";

export const MOLECULE_FORMATS = ["pdb", "sdf", "mol", "xyz", "cif", "mol2"] as const;
export const MOLECULE_STYLES = ["cartoon", "stick", "sphere", "line"] as const;
export const MOLECULE_COLORS = ["spectrum", "chain", "element", "residue", "ss"] as const;
export const MOLECULE_MAX_BYTES = 6 * 1024 * 1024;

export type MoleculeFormat = (typeof MOLECULE_FORMATS)[number];
export type MoleculeStyle = (typeof MOLECULE_STYLES)[number];
export type MoleculeColor = (typeof MOLECULE_COLORS)[number];
export type MoleculeProblem = "path" | "format" | "style" | "color" | "empty";

export interface MoleculeSpec {
  path: string | null;
  format: MoleculeFormat | null;
  style: MoleculeStyle | null;
  color: MoleculeColor | null;
  data: string;
}

export type MoleculeParse = { ok: true; spec: MoleculeSpec } | { ok: false; problem: MoleculeProblem; value: string };

const OPTIONS: ReadonlySet<string> = new Set(["path", "format", "style", "color", "colour"]);
const FORMAT_NAMES = new Map<string, MoleculeFormat>([
  ["pdb", "pdb"],
  ["ent", "pdb"],
  ["sdf", "sdf"],
  ["sd", "sdf"],
  ["mol", "mol"],
  ["xyz", "xyz"],
  ["cif", "cif"],
  ["mmcif", "cif"],
  ["mcif", "cif"],
  ["mol2", "mol2"],
]);
const XYZ_ELEMENT = /^[a-z]{1,3}$/iu;
const XYZ_NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/iu;
const XYZ_NUMBER_START = /^[-+]?\.?\d/u;
const COUNTS_LINE = /V[23]000\s*$/u;

function member<T extends string>(values: readonly T[], value: string): T | null {
  const lower = value.trim().toLowerCase();
  return values.find((item) => item === lower) ?? null;
}

export function parseMoleculeSource(source: string): MoleculeParse {
  const { options, body } = splitBlockOptions(source, OPTIONS);
  const formatText = options.get("format");
  const format = formatText === undefined ? null : (FORMAT_NAMES.get(formatText.toLowerCase()) ?? null);
  if (formatText !== undefined && !format) return { ok: false, problem: "format", value: formatText };
  const styleText = options.get("style");
  const style = styleText === undefined ? null : member(MOLECULE_STYLES, styleText);
  if (styleText !== undefined && !style) return { ok: false, problem: "style", value: styleText };
  const colorText = options.get("color") ?? options.get("colour");
  const color = colorText === undefined ? null : member(MOLECULE_COLORS, colorText);
  if (colorText !== undefined && !color) return { ok: false, problem: "color", value: colorText };
  const written = options.get("path");
  const path = written === undefined ? null : notePath(written);
  if (written !== undefined && !path) return { ok: false, problem: "path", value: written };
  if (!path && !body.trim()) return { ok: false, problem: "empty", value: "" };
  return { ok: true, spec: { path, format, style, color, data: path ? "" : body } };
}

export type MoleculeOption = "style" | "color";

const OPTION_NAMES: Readonly<Record<MoleculeOption, readonly string[]>> = {
  style: ["style"],
  color: ["color", "colour"],
};

export function withMoleculeOption(source: string, option: MoleculeOption, value: string): string {
  const lines = source.split(/\r?\n/u);
  let last = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const name = parseOptionLine(line)?.name.toLowerCase();
    if (!name || !OPTIONS.has(name)) break;
    if (OPTION_NAMES[option].includes(name)) {
      lines[index] = `${lines[index].slice(0, lines[index].indexOf(":"))}: ${value}`;
      return lines.join("\n");
    }
    last = index;
  }
  lines.splice(last + 1, 0, `${option}: ${value}`);
  return lines.join("\n");
}

function isXyzAtomLine(line: string): boolean {
  const [element = "", x = "", y = "", z = ""] = line.trimStart().split(/\s+/u);
  return XYZ_ELEMENT.test(element) && XYZ_NUMBER.test(x) && XYZ_NUMBER.test(y) && XYZ_NUMBER_START.test(z);
}

function looksLikeXyz(text: string): boolean {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() !== "");
  if (!/^\s*\d+\s*$/u.test(lines[start] ?? "")) return false;
  return isXyzAtomLine(lines[start + 2] ?? "");
}

export function sniffMoleculeFormat(text: string): MoleculeFormat | null {
  if (/^@<TRIPOS>MOLECULE/mu.test(text)) return "mol2";
  if (/^data_/mu.test(text) && /^(?:loop_|_atom_site)/mu.test(text)) return "cif";
  if (/^(?:ATOM {2}|HETATM)/mu.test(text)) return "pdb";
  if (/V[23]000/u.test(text) || /^\$\$\$\$/mu.test(text)) return "sdf";
  return looksLikeXyz(text) ? "xyz" : null;
}

export function resolveMoleculeFormat(spec: MoleculeSpec, fence: string | undefined, text: string): MoleculeFormat | null {
  if (spec.format) return spec.format;
  const fromFence = fence ? FORMAT_NAMES.get(fence) : undefined;
  if (fromFence) return fromFence;
  const extension = spec.path ? /\.([a-z0-9]+)$/iu.exec(spec.path)?.[1].toLowerCase() : undefined;
  const fromPath = extension ? FORMAT_NAMES.get(extension) : undefined;
  return fromPath ?? sniffMoleculeFormat(text);
}

export function repairMolHeader(text: string): string {
  const lines = text.split(/\r?\n/u);
  const counts = lines.findIndex((line) => COUNTS_LINE.test(line));
  if (counts < 0 || counts >= 3) return text;
  return [...new Array<string>(3 - counts).fill(""), ...lines].join("\n");
}

export function moleculeData(text: string, format: MoleculeFormat): string {
  return format === "sdf" || format === "mol" ? repairMolHeader(text) : text;
}

export class MoleculeFileError extends Error {
  readonly problem: "missing" | "unreadable";

  constructor(problem: "missing" | "unreadable") {
    super(`The molecule file could not be read (${problem}).`);
    this.name = "MoleculeFileError";
    this.problem = problem;
  }
}

export async function moleculeText(spec: MoleculeSpec, readFile: NoteFile | undefined): Promise<string> {
  if (!spec.path) return spec.data;
  const url = readFile ? await readFile(spec.path) : null;
  if (url === null) throw new MoleculeFileError("missing");
  const text = dataUrlText(url, MOLECULE_MAX_BYTES);
  if (text === null) throw new MoleculeFileError("unreadable");
  return text;
}

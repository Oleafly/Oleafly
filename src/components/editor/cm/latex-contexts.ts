import type { PackageCatalog } from "@oleafly/latex-intelligence";

// Pure completion-context recognizers over the text before (and, for
// package options, after) the cursor. Kept free of CodeMirror imports so
// each recognizer is testable as a plain function.

export interface GlossaryKeyContext {
  readonly query: string;
}

export interface PackageOptionContext {
  readonly kind: "package" | "class";
  readonly name: string;
  readonly query: string;
}

export interface KeyvalContext {
  readonly command: string;
  readonly query: string;
}

export interface ImportPathContext {
  readonly directory: string;
  readonly query: string;
}

export interface FileTargetContext {
  readonly command: string;
  readonly query: string;
}

const GLOSSARY_KEY_RE =
  /\\(?:glssymbol|glsdesc|glslink|glspl|Glspl|GLSpl|gls|Gls|GLS|acrshort|acrlong|acrfull|acs|acl|acf|Acs|Acl|Acf|ac|Ac)\*?\s*\{[^{}]*?(?:,\s*)?([^,{}]*)$/u;

export function recognizeGlossaryKey(
  before: string,
): GlossaryKeyContext | null {
  const match = GLOSSARY_KEY_RE.exec(before);
  return match ? { query: (match[1] ?? "").trimStart() } : null;
}

const PACKAGE_OPTION_BEFORE_RE =
  /\\(usepackage|RequirePackage|documentclass)\s*\[[^\]]*?(?:,\s*)?([^,\]]*)$/u;
const PACKAGE_OPTION_AFTER_RE = /^[^\]]*\]\s*\{([^{},]+)\}/u;

/** `\usepackage[<cursor>]{name}` — the target name is read after the cursor. */
export function recognizePackageOption(
  before: string,
  after: string,
): PackageOptionContext | null {
  const open = PACKAGE_OPTION_BEFORE_RE.exec(before);
  if (!open) return null;
  const target = PACKAGE_OPTION_AFTER_RE.exec(after);
  if (!target) return null;
  return {
    kind: open[1] === "documentclass" ? "class" : "package",
    name: target[1].trim(),
    query: (open[2] ?? "").trimStart(),
  };
}

const KEYVAL_RE =
  /\\([A-Za-z@]+)\*?\s*(?:\[[^\]]*\])*\s*\{[^{}]*?(?:[,{]\s*)?([A-Za-z@ -]*)$/u;

export function recognizeKeyval(before: string): KeyvalContext | null {
  const match = KEYVAL_RE.exec(before);
  if (!match) return null;
  return { command: match[1], query: (match[2] ?? "").trimStart() };
}

const IMPORT_PATH_RE =
  /\\(?:import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)\*?\s*\{([^{}]*)\}\s*\{([^{}]*)$/u;

export function recognizeImportPath(
  before: string,
): ImportPathContext | null {
  const match = IMPORT_PATH_RE.exec(before);
  if (!match) return null;
  return {
    directory: match[1].trim().replace(/\/+$/u, ""),
    query: match[2] ?? "",
  };
}

const FILE_TARGET_RE =
  /\\(input|include|subfile|includegraphics|includesvg|includepdf|bibliography|addbibresource)\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)$/u;

export function recognizeFileTarget(
  before: string,
): FileTargetContext | null {
  const match = FILE_TARGET_RE.exec(before);
  return match
    ? { command: match[1], query: match[2] ?? "" }
    : null;
}

const IMAGE_TARGET_RE = /\.(?:png|jpe?g|pdf|svg|eps|gif|webp)$/iu;
const BIB_TARGET_RE = /\.bib$/iu;
const SOURCE_TARGET_RE = /\.(?:tex|latex|ltx)$/iu;

/** Extension filter for the file kinds a command actually accepts. */
export function fileTargetAccepts(
  command: string,
  path: string,
): boolean {
  if (command === "includegraphics" || command === "includesvg") {
    return IMAGE_TARGET_RE.test(path);
  }
  if (command === "includepdf") return /\.pdf$/iu.test(path);
  if (
    command === "bibliography" ||
    command === "addbibresource"
  ) {
    return BIB_TARGET_RE.test(path);
  }
  return SOURCE_TARGET_RE.test(path);
}

function keysForLookup(
  catalog: PackageCatalog,
  predicate: (lookup: string) => boolean,
): string[] {
  return Object.entries(catalog.keys)
    .filter(([lookup]) => lookup.split(",").some(predicate))
    .flatMap(([, keys]) => keys);
}

/** Option keys accepted by `\usepackage[...]{name}` / `\documentclass[...]{name}`. */
export function optionKeysForCatalog(
  catalog: PackageCatalog,
  kind: "package" | "class",
  name: string,
): string[] {
  const marker =
    kind === "class"
      ? `\\documentclass/${name}`
      : `\\usepackage/${name}`;
  const keys = keysForLookup(catalog, (lookup) =>
    lookup.startsWith(marker),
  );
  return [...new Set([...(catalog.options ?? []), ...keys])].sort();
}

/** Key=value keys accepted inside the arguments of `\<command>{...}`. */
export function keyvalKeysForCommand(
  catalogs: readonly PackageCatalog[],
  command: string,
): string[] {
  const marker = `\\${command}`;
  const keys = catalogs.flatMap((catalog) =>
    keysForLookup(
      catalog,
      (lookup) =>
        lookup === marker || lookup.startsWith(`${marker}/`),
    ),
  );
  return [...new Set(keys)].sort();
}

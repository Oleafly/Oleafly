/**
 * Types for the generated package corpus produced by
 * scripts/latex-intelligence-extract.mjs into public/latex-intelligence.
 *
 * All snippets use the CodeMirror snippet() grammar (`${N}` / `${N:placeholder}`).
 */

export interface CoreCommand {
  name: string;
  snippet?: string;
  detail?: string;
  documentation?: string;
}

export interface CoreEnvironment {
  name: string;
  snippet?: string;
}

/** core.json: default commands and environments. */
export interface CoreCatalog {
  commands: CoreCommand[];
  environments: CoreEnvironment[];
}

/** A macro contributed by a package or class. */
export interface CorpusMacro {
  name: string;
  snippet?: string;
  detail?: string;
  documentation?: string;
  unusual?: boolean;
  /** Lookup keys into the owning catalog's `keys` map. */
  keys?: string[];
  /** Which argument of the snippet takes key=value options. */
  keyPos?: number;
}

/** An environment contributed by a package or class. */
export interface CorpusEnvironment {
  name: string;
  snippet?: string;
  detail?: string;
  unusual?: boolean;
  keys?: string[];
  keyPos?: number;
}

/** packages/<name>.json: one package (or `class-<name>` class) catalog. */
export interface PackageCatalog {
  /** Names of packages this one loads, including option-conditional ones. */
  deps: string[];
  macros: CorpusMacro[];
  envs: CorpusEnvironment[];
  /** Key-value completions, addressed by `CorpusMacro.keys`. */
  keys: Record<string, string[]>;
  args: string[];
  /** Package/class option completions (legacy CWL-format files only). */
  options?: string[];
}

/**
 * at-suggestions.json: one math-mode `@` shortcut (the
 * `@`-snippets, e.g. `@a` → `\alpha`). Triggers keep their leading `@`;
 * replacements use the CodeMirror snippet() grammar.
 */
export interface AtSuggestion {
  trigger: string;
  replacement: string;
  detail?: string;
}

/** package-names.json and class-names.json. */
export interface NameList {
  names: string[];
  /** Human-readable descriptions; names with no description are omitted. */
  details: Record<string, string>;
}

/** manifest.json: provenance of the vendored corpus. */
export interface Manifest {
  /** What the catalogs were generated from. */
  source: string;
  /** The TeX Live release read, so a regeneration is reproducible. */
  texlive: string;
  license: string;
  generatedBy: string;
  /** How many catalogs the corpus holds. */
  catalogs: number;
  notices: string[];
  generated?: string;
}

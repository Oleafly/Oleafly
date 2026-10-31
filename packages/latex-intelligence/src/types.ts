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

export interface CoreCatalog {
  commands: CoreCommand[];
  environments: CoreEnvironment[];
}

export interface CorpusMacro {
  name: string;
  snippet?: string;
  detail?: string;
  documentation?: string;
  unusual?: boolean;
  keys?: string[];
  keyPos?: number;
}

export interface CorpusEnvironment {
  name: string;
  snippet?: string;
  detail?: string;
  unusual?: boolean;
  keys?: string[];
  keyPos?: number;
}

export interface PackageCatalog {
  deps: string[];
  macros: CorpusMacro[];
  envs: CorpusEnvironment[];
  keys: Record<string, string[]>;
  args: string[];
  options?: string[];
}

export interface AtSuggestion {
  trigger: string;
  replacement: string;
  detail?: string;
}

export interface NameList {
  names: string[];
  details: Record<string, string>;
}

export interface Manifest {
  source: string;
  texlive: string;
  license: string;
  generatedBy: string;
  catalogs: number;
  notices: string[];
  generated?: string;
}

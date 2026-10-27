// The catalog of author-declared Typst function forms, as the desktop's Rust parser sends it
// (`crates/oleafly-core/src/typst_forms.rs`). These types mirror its serde shapes by hand;
// `test/fixtures/typst-forms/expected/catalog.json` locks both sides. Every absent optional
// arrives as `null`. This module stays free of CodeMirror so the app can import it without
// loading the Visual mode chunk.

import type { ArgRef } from "./typst-arguments";

export type TypstFormBinding =
  | { readonly kind: "package"; readonly spec: string }
  | { readonly kind: "module"; readonly path: string };

export interface TypstChoiceOption {
  readonly value: string;
  readonly label: string;
}

export type TypstFieldKind =
  | { readonly type: "text"; readonly multiline: boolean; readonly default: string | null }
  | { readonly type: "content" }
  | { readonly type: "choice"; readonly options: readonly TypstChoiceOption[]; readonly default: string | null }
  | {
      readonly type: "number";
      readonly integer: boolean;
      readonly min: number | null;
      readonly max: number | null;
      readonly step: number | null;
      readonly default: number | null;
    }
  | { readonly type: "toggle"; readonly default: boolean | null };

export interface TypstFormField {
  readonly arg: ArgRef;
  readonly label: string;
  readonly help: string | null;
  readonly placeholder: string | null;
  readonly required: boolean;
  readonly kind: TypstFieldKind;
}

export interface TypstFormDefinition {
  readonly id: string;
  readonly function: string;
  readonly binding: TypstFormBinding;
  readonly label: string;
  readonly summary: ArgRef | null;
  readonly fields: readonly TypstFormField[];
}

// `DiagnosticCode` in the Rust parser.
export type TypstFormDiagnosticCode =
  | "parseError"
  | "schemaMissing"
  | "schemaVersion"
  | "fileTooLarge"
  | "unreadable"
  | "invalidPackageSpec"
  | "missingKey"
  | "unknownKey"
  | "invalidValue"
  | "invalidFunction"
  | "builtinName"
  | "duplicateFunction"
  | "moduleRequired"
  | "moduleNotAllowed"
  | "invalidModulePath"
  | "invalidArg"
  | "duplicateArg"
  | "unknownKind";

export interface TypstFormDiagnostic {
  readonly source: string;
  readonly severity: "error" | "warning";
  readonly code: TypstFormDiagnosticCode;
  readonly path: string;
  readonly line: number | null;
  readonly detail: string;
}

export interface TypstFormCatalog {
  readonly version: string;
  readonly watch: readonly string[];
  readonly forms: readonly TypstFormDefinition[];
  readonly diagnostics: readonly TypstFormDiagnostic[];
}

export interface TypstPackageSpec {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
}

// `@namespace/name:major.minor.patch`, the way a form binding and an import write it.
export function parseTypstPackageSpec(spec: string): TypstPackageSpec | null {
  const match = /^@([^\s/:]+)\/([^\s/:]+):(\d+\.\d+\.\d+)$/u.exec(spec);
  return match ? { namespace: match[1], name: match[2], version: match[3] } : null;
}

export const EMPTY_TYPST_FORM_CATALOG: TypstFormCatalog = { version: "", watch: [], forms: [], diagnostics: [] };

export interface TypstFormsPort {
  snapshot(): TypstFormCatalog;
  subscribe(listener: () => void): () => void;
  // The package specs (`@ns/name:version`) the open document imports.
  want(packages: readonly string[]): void;
}

export interface StaticTypstForms extends TypstFormsPort {
  set(next: TypstFormCatalog): void;
  wanted(): readonly string[];
}

export function staticTypstForms(initial: TypstFormCatalog): StaticTypstForms {
  let catalog = initial;
  let wanted: readonly string[] = [];
  const listeners = new Set<() => void>();
  return {
    snapshot: () => catalog,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    want(packages) {
      wanted = packages;
    },
    set(next) {
      catalog = next;
      for (const listener of [...listeners]) listener();
    },
    wanted: () => wanted,
  };
}

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

export type TypstFormValueType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "datetime"
  | "array"
  | "inlineTable"
  | "table"
  | "arrayOfTables"
  | "none";

type FoundType = { readonly found: TypstFormValueType };
type KeyName = { readonly key: string };
type ModulePath = { readonly module: string };
type FunctionName = { readonly function: string };

export type TypstFormMessage =
  | { readonly id: "fileTooLarge"; readonly size: number; readonly limit: number }
  | { readonly id: "unreadable"; readonly reason: string }
  | { readonly id: "invalidPackageSpec"; readonly spec: string }
  | { readonly id: "notToml" | "notToml10"; readonly error: string }
  | {
      readonly id:
        | "notUtf8"
        | "noOleaflyTable"
        | "formsNotList"
        | "noSchema"
        | "moduleNotAllowed"
        | "moduleRequired"
        | "noFields"
        | "stepNotPositive"
        | "noOptions";
    }
  | ({
      readonly id:
        | "oleaflyNotTable"
        | "formNotTable"
        | "schemaNotNumber"
        | "fieldsNotList"
        | "fieldNotTable"
        | "optionsNotList"
        | "optionNotStringOrTable";
    } & FoundType)
  | { readonly id: "schemaUnsupported"; readonly schema: number }
  | { readonly id: "summaryNotAField" | "duplicateArg"; readonly arg: ArgRef }
  | ({ readonly id: "duplicateFunction" | "invalidFunction" | "builtinName" } & FunctionName)
  | ({ readonly id: "duplicateModuleFunction" } & FunctionName & ModulePath)
  | ({
      readonly id:
        | "modulePathEmpty"
        | "modulePathPackage"
        | "modulePathBackslash"
        | "modulePathAbsolute"
        | "modulePathParent"
        | "modulePathEmptyFolder";
    } & ModulePath)
  | { readonly id: "unknownKind"; readonly kind: string }
  | { readonly id: "defaultNotOption" | "duplicateOption"; readonly value: string }
  | { readonly id: "maxBelowMin"; readonly min: string; readonly max: string }
  | ({ readonly id: "notArg" | "missingKey" | "unknownKey" | "blank" | "notFinite" } & KeyName)
  | ({ readonly id: "keyNotForKind"; readonly kind: string } & KeyName)
  | ({ readonly id: "notString" | "notNumber" | "notBoolean" } & KeyName & FoundType);

export type TypstFormMessageId = TypstFormMessage["id"];

export interface TypstFormDiagnostic {
  readonly source: string;
  readonly severity: "error" | "warning";
  readonly code: TypstFormDiagnosticCode;
  readonly path: string;
  readonly line: number | null;
  readonly message: TypstFormMessage;
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
      for (const listener of Array.from(listeners)) listener();
    },
    wanted: () => wanted,
  };
}

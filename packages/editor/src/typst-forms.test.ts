import { describe, expect, it } from "vitest";
import {
  EMPTY_TYPST_FORM_CATALOG,
  staticTypstForms,
  type TypstFieldKind,
  type TypstFormCatalog,
  type TypstFormDefinition,
  type TypstFormDiagnostic,
  type TypstFormField,
} from "./typst-forms";
import { typstFormsGolden } from "./typst-forms-test-support";

type Exhaustive<T, K extends readonly (keyof T & string)[]> = [Exclude<keyof T, K[number]>] extends [never] ? K : never;

function keys<T>() {
  return <const K extends readonly (keyof T & string)[]>(list: Exhaustive<T, K>): readonly string[] => [...list].sort();
}

const FORM_KEYS = keys<TypstFormDefinition>()(["id", "function", "binding", "label", "summary", "fields"]);
const FIELD_KEYS = keys<TypstFormField>()(["arg", "label", "help", "placeholder", "required", "kind"]);
const DIAGNOSTIC_KEYS = keys<TypstFormDiagnostic>()(["source", "severity", "code", "path", "line", "message"]);
const KIND_KEYS: Record<TypstFieldKind["type"], readonly string[]> = {
  text: keys<Extract<TypstFieldKind, { type: "text" }>>()(["type", "multiline", "default"]),
  content: keys<Extract<TypstFieldKind, { type: "content" }>>()(["type"]),
  choice: keys<Extract<TypstFieldKind, { type: "choice" }>>()(["type", "options", "default"]),
  number: keys<Extract<TypstFieldKind, { type: "number" }>>()(["type", "integer", "min", "max", "step", "default"]),
  toggle: keys<Extract<TypstFieldKind, { type: "toggle" }>>()(["type", "default"]),
};

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe("the Typst forms wire contract", () => {
  it("matches every key of the golden catalog the Rust parser produces", () => {
    const golden = typstFormsGolden();
    expect(golden.forms.length).toBeGreaterThan(0);
    for (const form of golden.forms) {
      expect(sortedKeys(form), form.id).toEqual(FORM_KEYS);
      expect(["package", "module"]).toContain(form.binding.kind);
      expect(sortedKeys(form.binding)).toEqual(form.binding.kind === "package" ? ["kind", "spec"] : ["kind", "path"]);
      expect(form.id).toBe(
        form.binding.kind === "package" ? `pkg:${form.binding.spec}#${form.function}` : `mod:${form.binding.path}#${form.function}`,
      );
      if (form.summary) expect(sortedKeys(form.summary)).toHaveLength(1);
      for (const field of form.fields) {
        expect(sortedKeys(field), `${form.id} ${field.label}`).toEqual(FIELD_KEYS);
        expect(sortedKeys(field.kind), `${form.id} ${field.label}`).toEqual(KIND_KEYS[field.kind.type]);
        if (field.kind.type === "choice") {
          for (const option of field.kind.options) expect(sortedKeys(option)).toEqual(["label", "value"]);
        }
      }
    }
    for (const diagnostic of golden.diagnostics) {
      expect(sortedKeys(diagnostic)).toEqual(DIAGNOSTIC_KEYS);
      expect(["error", "warning"]).toContain(diagnostic.severity);
    }
  });

  it("starts empty", () => {
    expect(EMPTY_TYPST_FORM_CATALOG).toEqual({ version: "", watch: [], forms: [], diagnostics: [] });
  });
});

describe("staticTypstForms", () => {
  it("notifies subscribers when the catalog is replaced, until they unsubscribe", () => {
    const port = staticTypstForms(EMPTY_TYPST_FORM_CATALOG);
    const seen: TypstFormCatalog[] = [];
    const unsubscribe = port.subscribe(() => seen.push(port.snapshot()));
    const golden = typstFormsGolden();
    port.set(golden);
    unsubscribe();
    port.set(EMPTY_TYPST_FORM_CATALOG);
    expect(seen).toEqual([golden]);
    expect(port.snapshot()).toBe(EMPTY_TYPST_FORM_CATALOG);
  });

  it("records the packages the editor asks for", () => {
    const port = staticTypstForms(EMPTY_TYPST_FORM_CATALOG);
    expect(port.wanted()).toEqual([]);
    port.want(["@local/acme-report:0.1.0"]);
    expect(port.wanted()).toEqual(["@local/acme-report:0.1.0"]);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import type { TypstFormCatalog } from "./typst-forms";

export const TYPST_FORMS_FIXTURE_ROOT = path.join(process.cwd(), "test/fixtures/typst-forms");

export function readTypstFormsFixture(relative: string): string {
  return readFileSync(path.join(TYPST_FORMS_FIXTURE_ROOT, relative), "utf8");
}

// The golden catalog the Rust parser produces for the fixture project. `version` and
// `watch` depend on the machine, so the golden leaves them out.
export function typstFormsGolden(): TypstFormCatalog {
  const golden = JSON.parse(readTypstFormsFixture("expected/catalog.json")) as Pick<
    TypstFormCatalog,
    "forms" | "diagnostics"
  >;
  return { version: "golden", watch: ["oleafly-forms.toml"], ...golden };
}

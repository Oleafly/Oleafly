import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { parseTypstPackageSpec, type TypstFormCatalog, type TypstFormDiagnostic } from "@oleafly/editor/typst-forms";
import { i18n } from "@/i18n";
import { startTypstFormsSync, useTypstFormsStore } from "@/store/typst-forms";

// A diagnostic names its file by source: the project file's own path, or the spec of the
// package whose typst.toml it came from (vendored copies live at `<ns>/<name>/<version>/`).
function belongsTo(diagnostic: TypstFormDiagnostic, path: string): boolean {
  if (diagnostic.source === path) return true;
  const spec = parseTypstPackageSpec(diagnostic.source);
  if (!spec) return false;
  const tail = `${spec.namespace}/${spec.name}/${spec.version}/typst.toml`;
  return path === tail || path.endsWith(`/${tail}`);
}

export function typstFormDiagnosticsFor(path: string | null, catalog: TypstFormCatalog): TypstFormDiagnostic[] {
  if (!path || !catalog.watch.includes(path)) return [];
  return catalog.diagnostics.filter((diagnostic) => belongsTo(diagnostic, path));
}

function message(diagnostic: TypstFormDiagnostic, withPath: boolean): string {
  const label = i18n.t(($) => $.editor.typstForms.diagnostic[diagnostic.code]);
  const text = i18n.t(($) => $.editor.typstForms.message, { label, detail: diagnostic.detail });
  return withPath ? i18n.t(($) => $.editor.typstForms.atKeyPath, { message: text, path: diagnostic.path }) : text;
}

// Marks each problem the forms parser found in this oleafly-forms.toml or vendored typst.toml.
export function typstFormsLint(path: string): Extension {
  return linter((view): Diagnostic[] => {
    startTypstFormsSync();
    const { doc } = view.state;
    return typstFormDiagnosticsFor(path, useTypstFormsStore.getState().catalog).map((diagnostic) => {
      const line = doc.line(Math.min(Math.max(1, diagnostic.line ?? 1), doc.lines));
      return {
        from: line.from,
        to: line.to,
        severity: diagnostic.severity,
        message: message(diagnostic, diagnostic.line === null),
        source: "typst-forms",
      };
    });
  });
}

import { type Diagnostic, forceLinting, forEachDiagnostic, linter } from "@codemirror/lint";
import { type Extension, StateEffect } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { parseTypstPackageSpec, type TypstFormCatalog, type TypstFormDiagnostic } from "@oleafly/editor/typst-forms";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { startTypstFormsSync, useTypstFormsStore } from "@/store/typst-forms";

const SOURCE = "typst-forms";
const FORMS_FILES = new Set(["oleafly-forms.toml", "typst.toml"]);
const VENDORED_MANIFEST = /^typst-packages\/([^/]+)\/([^/]+)\/([^/]+)\/typst\.toml$/u;

// Forms are declared only in these files, so Cargo.toml or pyproject.toml gets no forms lint.
export function hasTypstFormsLint(path: string | null): path is string {
  return !!path && FORMS_FILES.has(path.slice(path.lastIndexOf("/") + 1));
}

// The package a vendored manifest (`typst-packages/<ns>/<name>/<version>/typst.toml`) belongs to.
export function vendoredPackageSpec(path: string): string | null {
  const match = VENDORED_MANIFEST.exec(path);
  if (!match) return null;
  const spec = `@${match[1]}/${match[2]}:${match[3]}`;
  return parseTypstPackageSpec(spec) ? spec : null;
}

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

const catalogChanged = StateEffect.define<null>();

function catalogReloaded(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.effects.some((effect) => effect.is(catalogChanged)));
}

// Runs this view's forms lint again when the catalog reloads, without asking any other
// editor or linter to run.
const followCatalog = ViewPlugin.fromClass(
  class {
    private queued = false;
    private live = true;
    private readonly stop: () => void;

    constructor(view: EditorView) {
      this.stop = useTypstFormsStore.subscribe((state, previous) => {
        if (state.catalog === previous.catalog || this.queued) return;
        this.queued = true;
        // The store can change while an editor updates, and a view can't dispatch then.
        queueMicrotask(() => {
          this.queued = false;
          if (!this.live) return;
          view.dispatch({ effects: catalogChanged.of(null) });
          forceLinting(view);
        });
      });
    }

    destroy(): void {
      this.live = false;
      this.stop();
    }
  },
);

// The markers as CodeMirror has moved them through the edits since the last run.
function shownDiagnostics(view: EditorView): Diagnostic[] {
  const shown: Diagnostic[] = [];
  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    if (diagnostic.source === SOURCE) shown.push({ ...diagnostic, from, to });
  });
  return shown;
}

// Marks each problem the forms parser found in this oleafly-forms.toml or vendored typst.toml.
export function typstFormsLint(path: string): Extension {
  const vendored = vendoredPackageSpec(path);
  const lint = linter(
    (view): Diagnostic[] => {
      startTypstFormsSync();
      const forms = useTypstFormsStore.getState();
      // A vendored manifest is read only for packages a document imports, so opening one asks.
      if (vendored) forms.want([vendored]);
      // The catalog's lines are the saved file's. Until a save reloads it, unsaved edits keep
      // the markers where CodeMirror moved them.
      if (useFilesStore.getState().files[path]?.dirty) return shownDiagnostics(view);
      const { doc } = view.state;
      return typstFormDiagnosticsFor(path, forms.catalog).map((diagnostic) => {
        const line = doc.line(Math.min(Math.max(1, diagnostic.line ?? 1), doc.lines));
        return {
          from: line.from,
          to: line.to,
          severity: diagnostic.severity,
          // A problem with the whole file, such as its size, has no key to name.
          message: message(diagnostic, diagnostic.line === null && diagnostic.path !== ""),
          source: SOURCE,
        };
      });
    },
    { needsRefresh: catalogReloaded },
  );
  return [lint, followCatalog];
}

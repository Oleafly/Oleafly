import { type Diagnostic, forceLinting, forEachDiagnostic, linter } from "@codemirror/lint";
import { type Extension, StateEffect } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { ArgRef } from "@oleafly/editor/typst-arguments";
import {
  parseTypstPackageSpec,
  type TypstFormCatalog,
  type TypstFormDiagnostic,
  type TypstFormMessage,
} from "@oleafly/editor/typst-forms";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { startTypstFormsSync, useTypstFormsStore } from "@/store/typst-forms";

const SOURCE = "typst-forms";
const FORMS_FILES = new Set(["oleafly-forms.toml", "typst.toml"]);
const VENDORED_MANIFEST = /^typst-packages\/([^/]+)\/([^/]+)\/([^/]+)\/typst\.toml$/u;

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

function argument(arg: ArgRef): string {
  return "named" in arg
    ? i18n.t(($) => $.editor.typstForms.argument.named, { name: arg.named })
    : i18n.t(($) => $.editor.typstForms.argument.positional, { index: arg.positional });
}

export function typstFormMessageText(message: TypstFormMessage): string {
  const { id, ...values } = message;
  const params: Record<string, unknown> = { ...values };
  if ("found" in message) params.found = i18n.t(($) => $.editor.typstForms.valueType[message.found]);
  if ("arg" in message) params.arg = argument(message.arg);
  return i18n.t(($) => $.editor.typstForms.messages[id], params);
}

function message(diagnostic: TypstFormDiagnostic, withPath: boolean): string {
  const label = i18n.t(($) => $.editor.typstForms.diagnostic[diagnostic.code]);
  const text = i18n.t(($) => $.editor.typstForms.message, { label, detail: typstFormMessageText(diagnostic.message) });
  return withPath ? i18n.t(($) => $.editor.typstForms.atKeyPath, { message: text, path: diagnostic.path }) : text;
}

const catalogChanged = StateEffect.define<null>();

function catalogReloaded(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.effects.some((effect) => effect.is(catalogChanged)));
}

const followCatalog = ViewPlugin.fromClass(
  class {
    private queued = false;
    private live = true;
    private readonly stop: () => void;

    constructor(view: EditorView) {
      this.stop = useTypstFormsStore.subscribe((state, previous) => {
        if (state.catalog === previous.catalog || this.queued) return;
        this.queued = true;
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

function shownDiagnostics(view: EditorView): Diagnostic[] {
  const shown: Diagnostic[] = [];
  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    if (diagnostic.source === SOURCE) shown.push({ ...diagnostic, from, to });
  });
  return shown;
}

export function typstFormsLint(path: string): Extension {
  const vendored = vendoredPackageSpec(path);
  const lint = linter(
    (view): Diagnostic[] => {
      startTypstFormsSync();
      const forms = useTypstFormsStore.getState();
      if (vendored) forms.want([vendored]);
      if (useFilesStore.getState().files[path]?.dirty) return shownDiagnostics(view);
      const { doc } = view.state;
      return typstFormDiagnosticsFor(path, forms.catalog).map((diagnostic) => {
        const line = doc.line(Math.min(Math.max(1, diagnostic.line ?? 1), doc.lines));
        return {
          from: line.from,
          to: line.to,
          severity: diagnostic.severity,
          message: message(diagnostic, diagnostic.line === null && diagnostic.path !== ""),
          source: SOURCE,
        };
      });
    },
    { needsRefresh: catalogReloaded },
  );
  return [lint, followCatalog];
}

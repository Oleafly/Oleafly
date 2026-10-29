import { syntaxTree } from "@codemirror/language";
import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { EMPTY_TYPST_FORM_CATALOG, type TypstFormCatalog, type TypstFormsPort } from "../../../typst-forms";
import { visualPortsFacet } from "../../facets";
import { buildFormIndex, documentBindings, FormScope } from "./scope";

export const setTypstFormCatalog = StateEffect.define<TypstFormCatalog>();

export const typstFormsField = StateField.define<TypstFormCatalog>({
  create: (state) => state.facet(visualPortsFacet)?.typstForms?.snapshot() ?? EMPTY_TYPST_FORM_CATALOG,
  update(catalog, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTypstFormCatalog)) catalog = effect.value;
    }
    return catalog;
  },
});

// Null when no form could match, so a build without forms runs no forms code.
export function formScopeFor(state: EditorState, tree: Tree): FormScope | null {
  const catalog = state.field(typstFormsField, false);
  if (!catalog || catalog.forms.length === 0) return null;
  return FormScope.create(buildFormIndex(catalog), documentBindings(state, tree));
}

// Keeps the field in step with the port, and tells the port which packages the document imports.
// Catalog changes are dispatched in a microtask, never inside a view update.
class TypstFormsSync {
  private readonly port: TypstFormsPort | null;
  private readonly unsubscribe: () => void;
  private wanted = "";
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.port = view.state.facet(visualPortsFacet)?.typstForms ?? null;
    this.unsubscribe = this.port?.subscribe(() => this.schedule()) ?? (() => undefined);
    this.reportPackages();
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (syntaxTree(update.state) !== syntaxTree(update.startState)) this.reportPackages();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
  }

  private reportPackages(): void {
    if (!this.port) return;
    const tree = syntaxTree(this.view.state);
    if (tree.type.name !== "Source") return;
    const packages = documentBindings(this.view.state, tree).packages;
    const key = packages.join("\n");
    if (key === this.wanted) return;
    this.wanted = key;
    this.port.want(packages);
  }

  private schedule(): void {
    if (!this.port) return;
    queueMicrotask(() => {
      if (this.destroyed || !this.port) return;
      const next = this.port.snapshot();
      if (next !== this.view.state.field(typstFormsField, false)) {
        this.view.dispatch({ effects: setTypstFormCatalog.of(next) });
      }
    });
  }
}

export const typstFormsSync = ViewPlugin.fromClass(TypstFormsSync);

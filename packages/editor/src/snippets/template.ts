import { type Completion, snippet } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { loadedSnippetRuntime, loadSnippetRuntime } from "./loader";

type TemplateApply = (view: EditorView, completion: Completion | null, from: number, to: number) => void;

function beforeRuntime(template: string): TemplateApply {
  loadSnippetRuntime().catch(() => undefined);
  return snippet(template);
}

export function insertTemplate(view: EditorView, template: string, from: number, to: number, completion?: Completion): void {
  const runtime = loadedSnippetRuntime();
  if (runtime) runtime.insertTemplate(view, template, from, to, completion);
  else beforeRuntime(template)(view, completion ?? null, from, to);
}

export function templateApply(template: string): TemplateApply {
  let apply: TemplateApply | null = null;
  return (view, completion, from, to) => {
    const runtime = loadedSnippetRuntime();
    if (!runtime) return beforeRuntime(template)(view, completion, from, to);
    apply ??= runtime.templateApply(template);
    apply(view, completion, from, to);
  };
}

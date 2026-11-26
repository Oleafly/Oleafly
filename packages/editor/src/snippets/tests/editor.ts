import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension, type Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { buildLibrary, parseSnippetFile, type SnippetLibrary, type SnippetRecord } from "@oleafly/snippets";
import { vi } from "vitest";
import { type SnippetPort, snippetPortFacet } from "../port";
import { nextSnippetField, previousSnippetField, snippetSessionExtension } from "../session";

export function snippetRecord(id: string, body: unknown, extra: Record<string, unknown> = {}): SnippetRecord {
  const file = parseSnippetFile(JSON.stringify({ [id]: { prefix: id, body, ...extra } }), "test", "user");
  const record = file.records[0];
  if (!record) throw new Error(file.problems.map((problem) => problem.message).join("\n"));
  return record;
}

export function libraryOf(entries: Record<string, unknown>): SnippetLibrary {
  const file = parseSnippetFile(JSON.stringify(entries), "test", "pack");
  if (file.problems.some((problem) => problem.severity === "error")) {
    throw new Error(file.problems.map((problem) => problem.message).join("\n"));
  }
  return buildLibrary({ files: [file], disabledCollections: new Set(), overrides: [], disabledRegex: new Set() });
}

export function portWith(entries: Record<string, unknown>, overrides: Partial<SnippetPort> = {}): SnippetPort {
  const library = libraryOf(entries);
  return fakePort({ library: () => library, ...overrides });
}

export function fakePort(overrides: Partial<SnippetPort> = {}): SnippetPort {
  return {
    library: () => buildLibrary({ files: [], disabledCollections: new Set(), overrides: [], disabledRegex: new Set() }),
    language: () => "latex",
    filePath: () => "/papers/main.tex",
    projectName: () => "Paper",
    typstVersion: () => undefined,
    enabled: () => ({ list: true, tab: true, auto: true, hint: true }),
    projectItems: () => [],
    useCount: () => 0,
    recordUse: vi.fn(),
    readClipboard: () => Promise.resolve(""),
    onAutoExpanded: vi.fn(),
    onHandTypedFraction: vi.fn(),
    reportSlowRegex: vi.fn(),
    ...overrides,
  };
}

const views: EditorView[] = [];

export function destroyViews(): void {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
}

export interface EditorOptions {
  port?: SnippetPort | null;
  extensions?: Extension[];
  session?: boolean;
  transactions?: Transaction[];
}

export function snippetEditor(marked: string, options: EditorOptions = {}): EditorView {
  const cursors: number[] = [];
  let doc = "";
  for (const character of marked) {
    if (character === "|") cursors.push(doc.length);
    else doc += character;
  }
  if (cursors.length === 0) cursors.push(doc.length);
  const parent = document.createElement("div");
  document.body.append(parent);
  const port = options.port === undefined ? fakePort() : options.port;
  const record = options.transactions;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(cursors.map((at) => EditorSelection.cursor(at))),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        history(),
        indentUnit.of("  "),
        closeBrackets(),
        ...(options.session === false
          ? []
          : [
              snippetSessionExtension(),
              keymap.of([{ key: "Tab", run: nextSnippetField, shift: previousSnippetField }]),
            ]),
        ...(port ? [snippetPortFacet.of(port)] : []),
        ...(options.extensions ?? []),
        ...(record ? [EditorView.updateListener.of((update) => record.push(...update.transactions))] : []),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap]),
      ],
    }),
  });
  views.push(view);
  return view;
}

export function withCursor(view: EditorView): string {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  if (from === to) return `${doc.slice(0, from)}|${doc.slice(from)}`;
  return `${doc.slice(0, from)}[${doc.slice(from, to)}]${doc.slice(to)}`;
}

export function input(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  const insert = () => view.state.update(view.state.replaceSelection(text), { userEvent: "input.type" });
  const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, text, insert));
  if (!handled) view.dispatch(insert());
}

export function type(view: EditorView, text: string): EditorView {
  for (const character of text) input(view, character);
  return view;
}

export function press(view: EditorView, key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

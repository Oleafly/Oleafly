import { clearSnippet, type Completion, pickedCompletion, startCompletion } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import {
  type Annotation,
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateEffect,
  Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  type BodyNode,
  bodyUses,
  parseCodeMirrorTemplate,
  type RenderEnv,
  type Rendered,
  renderBody,
  type SnippetLanguage,
  type SnippetRecord,
} from "@oleafly/snippets";
import { editorMessageOr } from "../message-keys";
import { editorMessage } from "../messages";
import { scheduleFlashEnd, snippetFlashEffect } from "./flash";
import { type SnippetPort, snippetPort } from "./port";
import {
  firstFieldOffersList,
  firstFieldSelection,
  needsSnippetSession,
  pushSnippetSession,
  snippetSessionFor,
  snippetSessionInstall,
} from "./session";

export type SnippetTriggerKind = "list" | "tab" | "auto" | "hint" | "palette";

interface InsertPlan {
  nodes: BodyNode[];
  recordId: string;
  name: string | null;
  wraps: boolean;
  captures: readonly string[];
  clipboard: string;
  userEvent: string | null;
  completion?: Completion;
}

const INDENT_PROBE = 256;
const LEADING_INDENT = /^[ \t]*/;

export function snippetBody(record: SnippetRecord, language: SnippetLanguage | null): BodyNode[] | null {
  const bodies = record.bodies;
  return (language ? bodies[language] : undefined) ?? bodies.default ?? Object.values(bodies).find(Boolean) ?? null;
}

export function snippetName(record: SnippetRecord): string {
  return editorMessageOr(record.nameKey, record.name);
}

function lineComment(state: EditorState, at: number, language: SnippetLanguage | null): string {
  const tokens = state.languageDataAt<{ line?: string }>("commentTokens", at);
  const line = tokens.find((token) => token.line)?.line;
  if (line) return line;
  return language === "latex" || language === "bibtex" ? "%" : "//";
}

function renderEnv(
  state: EditorState,
  range: SelectionRange,
  at: number,
  plan: InsertPlan,
  port: SnippetPort | null,
): RenderEnv {
  const line = state.doc.lineAt(at);
  const head = state.sliceDoc(line.from, Math.min(line.to, line.from + INDENT_PROBE));
  const language = port?.language() ?? null;
  return {
    selection: plan.wraps ? state.sliceDoc(range.from, range.to) : "",
    clipboard: plan.clipboard,
    now: new Date(),
    fileName: port?.filePath() ?? null,
    projectName: port?.projectName() ?? null,
    lineComment: lineComment(state, at, language),
    captures: [...plan.captures],
    indent: (LEADING_INDENT.exec(head) as RegExpExecArray)[0],
    indentUnit: state.facet(indentUnit),
  };
}

function clearedCodeMirrorSnippet(state: EditorState): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = [];
  clearSnippet({ state, dispatch: (tr: Transaction) => effects.push(...tr.effects) });
  return effects;
}

function annotationsFor(plan: InsertPlan): Annotation<unknown>[] {
  return [
    isolateHistory.of("full"),
    ...(plan.userEvent ? [Transaction.userEvent.of(plan.userEvent)] : []),
    ...(plan.completion ? [pickedCompletion.of(plan.completion)] : []),
  ];
}

function announced(plan: InsertPlan): StateEffect<unknown>[] {
  return plan.name ? [EditorView.announce.of(editorMessage("snippets.inserted", { name: plan.name }))] : [];
}

function restSelection(rendered: Rendered, from: number): EditorSelection {
  const exitField = rendered.fields.find((field) => field.index === 0);
  if (!exitField) return EditorSelection.single(from + rendered.exit);
  return EditorSelection.create(
    exitField.ranges.map((range) => EditorSelection.range(from + range.from, from + range.to)),
  );
}

function insertAtMain(view: EditorView, plan: InsertPlan, from: number, to: number): void {
  const state = view.state;
  const port = snippetPort(state);
  const rendered = renderBody(plan.nodes, renderEnv(state, state.selection.main, from, plan, port));
  const session = needsSnippetSession(rendered) ? snippetSessionFor(plan.recordId, rendered, from) : null;
  const flash = snippetFlashEffect(from, from + rendered.text.length);
  view.dispatch({
    changes: { from, to, insert: rendered.text },
    selection: session ? firstFieldSelection(session) : restSelection(rendered, from),
    effects: [
      ...clearedCodeMirrorSnippet(state),
      ...snippetSessionInstall(state),
      ...(session ? [pushSnippetSession.of(session)] : []),
      ...(flash ? [flash] : []),
      ...announced(plan),
    ],
    annotations: annotationsFor(plan),
    scrollIntoView: true,
  });
  scheduleFlashEnd(view, flash);
  if (session && firstFieldOffersList(session)) startCompletion(view);
}

function insertAtEachCursor(view: EditorView, plan: InsertPlan, from: number, to: number): void {
  const state = view.state;
  const port = snippetPort(state);
  const main = state.selection.main;
  const fromOffset = from - main.from;
  const toOffset = to - main.from;
  const replaced = state.sliceDoc(from, to);
  view.dispatch({
    ...state.changeByRange((range) => {
      const start = range === main ? from : range.from + fromOffset;
      const end = range === main ? to : range.from + toOffset;
      if (range !== main && state.sliceDoc(start, end) !== replaced) return { range };
      const rendered = renderBody(plan.nodes, renderEnv(state, range, start, plan, port));
      return {
        changes: { from: start, to: end, insert: rendered.text },
        range: EditorSelection.cursor(start + rendered.exit),
      };
    }),
    effects: [...clearedCodeMirrorSnippet(state), ...announced(plan)],
    annotations: annotationsFor(plan),
    scrollIntoView: true,
  });
}

function runPlan(view: EditorView, plan: InsertPlan, from: number, to: number): void {
  if (view.state.selection.ranges.length > 1) insertAtEachCursor(view, plan, from, to);
  else insertAtMain(view, plan, from, to);
}

function withClipboard(view: EditorView, port: SnippetPort, plan: InsertPlan, from: number, to: number): void {
  const doc = view.state.doc;
  const selection = view.state.selection;
  port
    .readClipboard()
    .catch(() => "")
    .then((clipboard) => {
      if (view.state.doc !== doc || !view.state.selection.eq(selection)) return;
      runPlan(view, { ...plan, clipboard }, from, to);
    });
}

export function insertSnippet(
  view: EditorView,
  record: SnippetRecord,
  from: number,
  to: number,
  kind: SnippetTriggerKind,
  captures: readonly string[] = [],
  completion?: Completion,
): boolean {
  const state = view.state;
  if (state.readOnly) return false;
  const port = snippetPort(state);
  const nodes = snippetBody(record, port?.language() ?? null);
  if (!nodes) return false;
  const plan: InsertPlan = {
    nodes,
    recordId: record.id,
    name: snippetName(record),
    wraps: record.wraps,
    captures,
    clipboard: "",
    userEvent: kind === "auto" ? "input.type" : "input.complete",
    ...(completion ? { completion } : {}),
  };
  if (port && bodyUses(nodes, "CLIPBOARD")) withClipboard(view, port, plan, from, to);
  else runPlan(view, plan, from, to);
  port?.recordUse(record.id);
  return true;
}

function insertNodes(
  view: EditorView,
  nodes: BodyNode[],
  from: number,
  to: number,
  completion: Completion | undefined,
): void {
  const main = view.state.selection.main;
  runPlan(
    view,
    {
      nodes,
      recordId: "",
      name: null,
      wraps: false,
      captures: [],
      clipboard: "",
      userEvent: completion ? "input.complete" : null,
      ...(completion ? { completion } : {}),
    },
    from,
    to === main.from ? main.to : to,
  );
}

export function insertTemplate(
  view: EditorView,
  template: string,
  from: number,
  to: number,
  completion?: Completion,
): void {
  insertNodes(view, parseCodeMirrorTemplate(template), from, to, completion);
}

export function templateApply(
  template: string,
): (view: EditorView, completion: Completion | null, from: number, to: number) => void {
  let nodes: BodyNode[] | null = null;
  return (view, completion, from, to) => {
    nodes ??= parseCodeMirrorTemplate(template);
    insertNodes(view, nodes, from, to, completion ?? undefined);
  };
}

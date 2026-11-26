import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { invertedEffects } from "@codemirror/commands";
import {
  type ChangeDesc,
  ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type Range,
  type SelectionRange,
  StateEffect,
  StateField,
  type Text,
  type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, showTooltip, type Tooltip, WidgetType } from "@codemirror/view";
import {
  applyHelper,
  applyRegexTransform,
  type FieldSpec,
  type MirrorSpec,
  type ProjectFieldKind,
  type Rendered,
} from "@oleafly/snippets";
import { documentLoad, remoteChange } from "../collaboration";
import { vimOwnsInput } from "../latex-structure-commands";
import { editorMessage } from "../messages";
import { snippetFlashField } from "./flash";
import { type SnippetProjectItem, snippetPort } from "./port";
import {
  ACTIVE_FIELD_CLASS,
  EMPTY_FIELD_CLASS,
  FIELD_CLASS,
  CARD_CLASS,
  CARD_COUNT_CLASS,
  CARD_KEY_CLASS,
  CARD_KEY_OFF_CLASS,
  CARD_KEY_PRIMARY_CLASS,
  CARD_KEYS_CLASS,
  CARD_SEPARATOR_CLASS,
  CARD_STEP_CLASS,
  CARD_STEP_DONE_CLASS,
  CARD_STEP_NOW_CLASS,
  CARD_STEPS_CLASS,
  MIRROR_CLASS,
  snippetSessionTheme,
} from "./session-theme";

export interface FieldRange {
  from: number;
  to: number;
}

export interface ActiveField {
  index: number;
  ranges: FieldRange[];
  choices?: string[];
  project?: ProjectFieldKind;
}

export type SessionMirror = MirrorSpec;

export interface SnippetSession {
  recordId: string;
  fields: ActiveField[];
  mirrors: SessionMirror[];
  active: number;
  exit: number;
}

type Stack = readonly SnippetSession[];

const EMPTY: Stack = [];

function mapRange(range: FieldRange, changes: ChangeDesc, fromAssoc: number, toAssoc: number): FieldRange {
  const from = changes.mapPos(range.from, fromAssoc);
  const to = Math.max(from, changes.mapPos(range.to, toAssoc));
  return from === range.from && to === range.to ? range : { from, to };
}

function mapMirror(mirror: SessionMirror, changes: ChangeDesc): SessionMirror {
  const range = mapRange(mirror, changes, 1, mirror.from === mirror.to ? 1 : -1);
  return range === mirror ? mirror : { ...mirror, ...range };
}

function mapFields(fields: readonly ActiveField[], changes: ChangeDesc, fromAssoc: number, toAssoc: number): ActiveField[] {
  return fields.map((field) => ({
    ...field,
    ranges: field.ranges.map((range) =>
      field.index === 0 && range.from === range.to
        ? mapRange(range, changes, 1, 1)
        : mapRange(range, changes, fromAssoc, toAssoc),
    ),
  }));
}

export function mapSnippetSession(session: SnippetSession, changes: ChangeDesc): SnippetSession {
  if (changes.empty) return session;
  return {
    ...session,
    fields: mapFields(session.fields, changes, -1, 1),
    mirrors: session.mirrors.map((mirror) => mapMirror(mirror, changes)),
    exit: changes.mapPos(session.exit, 1),
  };
}

function mapStack(stack: Stack, changes: ChangeDesc): Stack {
  return stack.map((session) => mapSnippetSession(session, changes));
}

export const pushSnippetSession = StateEffect.define<SnippetSession>({ map: mapSnippetSession });

export const popSnippetSession = StateEffect.define<null>();

const setActiveField = StateEffect.define<number>();

export const restoreSnippetSessions = StateEffect.define<Stack>({ map: mapStack });

const syncSessions = StateEffect.define<ReadonlyMap<SnippetSession, SnippetSession>>();

function sessionRanges(session: SnippetSession): FieldRange[] {
  return [...session.fields.flatMap((field) => field.ranges), ...session.mirrors];
}

function touchedBy(session: SnippetSession, changes: ChangeDesc): boolean {
  const ranges = sessionRanges(session);
  let touched = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (!touched) touched = ranges.some((range) => fromA <= range.to && toA >= range.from);
  });
  return touched;
}

function brokenByRemote(session: SnippetSession, changes: ChangeDesc): boolean {
  const ranges = session.fields.flatMap((field) => field.ranges);
  let broken = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (broken || fromA === toA) return;
    broken = ranges.some(
      (range) => fromA < range.to && toA > range.from && !(fromA >= range.from && toA <= range.to),
    );
  });
  return broken;
}

function holds(session: SnippetSession, selection: SelectionRange): boolean {
  return sessionRanges(session).some((range) => selection.from >= range.from && selection.to <= range.to);
}

function dropFromTop(stack: Stack, keep: (session: SnippetSession) => boolean): Stack {
  let end = stack.length;
  while (end > 0 && !keep(stack[end - 1])) end -= 1;
  return end === stack.length ? stack : stack.slice(0, end);
}

function syncOf(tr: Transaction): ReadonlyMap<SnippetSession, SnippetSession> | null {
  for (const effect of tr.effects) if (effect.is(syncSessions)) return effect.value;
  return null;
}

function settle(stack: Stack, tr: Transaction): Stack {
  if (tr.annotation(documentLoad)) return EMPTY;
  if (!tr.docChanged) return stack;
  let kept: Stack;
  if (tr.annotation(remoteChange)) kept = stack.filter((session) => !brokenByRemote(session, tr.changes));
  else if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return EMPTY;
  else kept = dropFromTop(stack, (session) => touchedBy(session, tr.changes));
  const sync = syncOf(tr);
  return kept.map((session) => sync?.get(session) ?? mapSnippetSession(session, tr.changes));
}

function sessionsChangedOnPurpose(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(pushSnippetSession) || effect.is(restoreSnippetSessions));
}

function withActive(stack: Stack, active: number): Stack {
  const top = stack.at(-1);
  return top ? [...stack.slice(0, -1), { ...top, active }] : stack;
}

export const snippetSessionField = StateField.define<Stack>({
  create: () => EMPTY,
  update(stack, tr) {
    let next = stack.length > 0 ? settle(stack, tr) : stack;
    for (const effect of tr.effects) {
      if (effect.is(restoreSnippetSessions)) next = effect.value;
      else if (effect.is(pushSnippetSession)) next = [...next, effect.value];
      else if (effect.is(popSnippetSession)) next = next.slice(0, -1);
      else if (effect.is(setActiveField)) next = withActive(next, effect.value);
    }
    if (next.length > 0 && tr.selection && !tr.annotation(remoteChange) && !sessionsChangedOnPurpose(tr)) {
      const main = tr.newSelection.main;
      next = dropFromTop(next, (session) => holds(session, main));
    }
    return next.length === 0 ? EMPTY : next;
  },
});

export function snippetSessions(state: EditorState): Stack {
  return state.field(snippetSessionField, false) ?? EMPTY;
}

export function innermostSnippetSession(state: EditorState): SnippetSession | null {
  return snippetSessions(state).at(-1) ?? null;
}

export function activeSnippetField(state: EditorState): ActiveField | null {
  const top = innermostSnippetSession(state);
  return top ? (top.fields[top.active] ?? null) : null;
}

function mirrorValue(mirror: SessionMirror, source: string): string {
  if (mirror.helper) return applyHelper(mirror.helper, source);
  if (mirror.regex) return applyRegexTransform(source, mirror.regex);
  return source;
}

interface MirrorSync {
  changes: ChangeSet;
  sessions: ReadonlyMap<SnippetSession, SnippetSession>;
}

function mirrorSync(stack: Stack, changes: ChangeDesc, doc: Text): MirrorSync | null {
  const mapped = mapStack(stack, changes);
  const specs: { from: number; to: number; insert: string }[] = [];
  const values = new Map<SessionMirror, string>();
  for (const session of mapped) {
    for (const mirror of session.mirrors) {
      const range = session.fields.find((field) => field.index === mirror.source)?.ranges[0];
      if (!range) continue;
      const value = mirrorValue(mirror, doc.sliceString(range.from, range.to));
      if (doc.sliceString(mirror.from, mirror.to) === value) continue;
      values.set(mirror, value);
      specs.push({ from: mirror.from, to: mirror.to, insert: value });
    }
  }
  if (specs.length === 0) return null;
  const mirrorChanges = ChangeSet.of(specs, doc.length);
  const place = (mirror: SessionMirror): SessionMirror => {
    const value = values.get(mirror);
    if (value === undefined) return mapMirror(mirror, mirrorChanges);
    const from = mirrorChanges.mapPos(mirror.from, -1);
    return { ...mirror, from, to: from + value.length };
  };
  const sessions = new Map<SnippetSession, SnippetSession>();
  stack.forEach((original, index) => {
    const session = mapped[index];
    sessions.set(original, {
      ...session,
      fields: mapFields(session.fields, mirrorChanges, 1, -1),
      mirrors: session.mirrors.map(place),
      exit: mirrorChanges.mapPos(session.exit, 1),
    });
  });
  return { changes: mirrorChanges, sessions };
}

function localEdit(tr: Transaction): boolean {
  return !(
    tr.annotation(remoteChange) ||
    tr.annotation(documentLoad) ||
    tr.isUserEvent("undo") ||
    tr.isUserEvent("redo") ||
    tr.isUserEvent("input.type.compose") ||
    tr.effects.some((effect) => effect.is(restoreSnippetSessions))
  );
}

const mirrorFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const stack = snippetSessions(tr.startState);
  if (stack.length === 0 || !localEdit(tr)) return tr;
  const sync = mirrorSync(stack, tr.changes, tr.newDoc);
  if (!sync) return tr;
  return [tr, { changes: sync.changes, sequential: true, effects: syncSessions.of(sync.sessions) }];
});

export function syncSnippetMirrors(view: EditorView): boolean {
  if (view.composing) return false;
  const state = view.state;
  const stack = snippetSessions(state);
  if (stack.length === 0) return false;
  const sync = mirrorSync(stack, ChangeSet.empty(state.doc.length), state.doc);
  if (!sync) return false;
  view.dispatch({
    changes: sync.changes,
    effects: syncSessions.of(sync.sessions),
    userEvent: "input.type.compose",
  });
  return true;
}

const compositionSync = EditorView.domEventHandlers({
  compositionend: (_event, view) => {
    setTimeout(() => syncSnippetMirrors(view), 0);
    return false;
  },
});

const sessionHistory = invertedEffects.of((tr) => {
  if (tr.changes.empty) return [];
  const before = snippetSessions(tr.startState);
  if (before.length === 0 && !sessionsChangedOnPurpose(tr)) return [];
  return [restoreSnippetSessions.of(before)];
});

function fieldSelection(field: ActiveField): EditorSelection {
  return EditorSelection.create(field.ranges.map((range) => EditorSelection.range(range.from, range.to)));
}

function offersList(field: ActiveField): boolean {
  return field.choices !== undefined || field.project !== undefined;
}

function fieldFinishesSession(session: SnippetSession, field: ActiveField): boolean {
  return field.index === 0 && !session.mirrors.some((mirror) => mirror.source === 0);
}

function moveToField(view: EditorView, session: SnippetSession, target: number): boolean {
  if (target >= session.fields.length) {
    const last = session.fields.at(-1);
    const anchor = last?.index === 0 ? last.ranges[0].to : session.exit;
    view.dispatch({
      selection: EditorSelection.cursor(anchor),
      effects: popSnippetSession.of(null),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }
  const field = session.fields[target];
  const finishes = fieldFinishesSession(session, field);
  view.dispatch({
    selection: fieldSelection(field),
    effects: finishes ? popSnippetSession.of(null) : setActiveField.of(target),
    scrollIntoView: true,
    userEvent: "select",
  });
  if (!finishes && offersList(field)) startCompletion(view);
  return true;
}

export function nextSnippetField(view: EditorView): boolean {
  const top = innermostSnippetSession(view.state);
  return top ? moveToField(view, top, top.active + 1) : false;
}

export function previousSnippetField(view: EditorView): boolean {
  const top = innermostSnippetSession(view.state);
  return top && top.active > 0 ? moveToField(view, top, top.active - 1) : false;
}

export function endSnippetSession(view: EditorView): boolean {
  if (!innermostSnippetSession(view.state) || completionStatus(view.state) === "active") return false;
  view.dispatch({ effects: popSnippetSession.of(null) });
  return false;
}

export function snippetFieldCompletions(context: CompletionContext): CompletionResult | null {
  const field = activeSnippetField(context.state);
  if (!field || !offersList(field)) return null;
  const range = field.ranges[0];
  if (context.pos < range.from || context.pos > range.to) return null;
  const items: readonly SnippetProjectItem[] = field.choices
    ? field.choices.map((label) => ({ label }))
    : (snippetPort(context.state)?.projectItems(field.project as ProjectFieldKind) ?? []);
  const main = context.state.selection.main;
  const whole = main.from === range.from && main.to === range.to;
  const query = whole ? "" : context.state.sliceDoc(range.from, context.pos).toLowerCase();
  const options: Completion[] = items
    .filter((item) => item.label.toLowerCase().includes(query))
    .map((item, order) => ({
      label: item.label,
      ...(item.detail ? { detail: item.detail } : {}),
      type: field.choices ? "enum" : "variable",
      boost: 99 - Math.min(order, 198),
    }));
  return options.length > 0 ? { from: range.from, to: range.to, options, filter: false } : null;
}

class EmptyField extends WidgetType {
  constructor(readonly active: boolean) {
    super();
  }

  eq(other: EmptyField): boolean {
    return other.active === this.active;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `${this.active ? ACTIVE_FIELD_CLASS : FIELD_CLASS} ${EMPTY_FIELD_CLASS}`;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
}

const activeMark = Decoration.mark({ class: ACTIVE_FIELD_CLASS });
const fieldMark = Decoration.mark({ class: FIELD_CLASS });
const mirrorMark = Decoration.mark({ class: MIRROR_CLASS });
const activeEmpty = Decoration.widget({ widget: new EmptyField(true) });
const fieldEmpty = Decoration.widget({ widget: new EmptyField(false) });

function sessionDecorations(state: EditorState): DecorationSet {
  const stack = snippetSessions(state);
  if (stack.length === 0) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  stack.forEach((session, depth) => {
    session.fields.forEach((field, order) => {
      const active = depth === stack.length - 1 && order === session.active;
      for (const range of field.ranges) {
        if (field.index === 0 && range.from === range.to) continue;
        ranges.push(
          range.from === range.to
            ? (active ? activeEmpty : fieldEmpty).range(range.from)
            : (active ? activeMark : fieldMark).range(range.from, range.to),
        );
      }
    });
    for (const mirror of session.mirrors) if (mirror.to > mirror.from) ranges.push(mirrorMark.range(mirror.from, mirror.to));
  });
  return Decoration.set(ranges, true);
}

const decorations = EditorView.decorations.compute([snippetSessionField], sessionDecorations);

const MAX_STEPS = 8;

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cardKey(key: string, label: string, extra = ""): HTMLElement {
  const wrapper = element("span", extra ? `${CARD_KEY_CLASS} ${extra}` : CARD_KEY_CLASS);
  wrapper.append(element("kbd", "", key), label);
  return wrapper;
}

function fieldCardDom(current: number, total: number): HTMLElement {
  const card = element("div", CARD_CLASS);
  card.setAttribute("aria-hidden", "true");
  if (total <= MAX_STEPS) {
    const steps = element("span", CARD_STEPS_CLASS);
    for (let step = 1; step <= total; step += 1) {
      const state = step < current ? CARD_STEP_DONE_CLASS : step === current ? CARD_STEP_NOW_CLASS : "";
      steps.append(element("span", state ? `${CARD_STEP_CLASS} ${state}` : CARD_STEP_CLASS));
    }
    card.append(steps);
  }
  card.append(element("span", CARD_COUNT_CLASS, editorMessage("snippets.field.position", { current, total })));
  const last = current === total;
  const list = element("span", CARD_KEYS_CLASS);
  list.append(
    cardKey("Tab", editorMessage(last ? "snippets.field.finish" : "snippets.field.next"), CARD_KEY_PRIMARY_CLASS),
    cardKey("⇧ Tab", editorMessage("snippets.field.back"), current === 1 ? CARD_KEY_OFF_CLASS : ""),
    cardKey("Esc", editorMessage("snippets.field.done")),
  );
  card.append(element("span", CARD_SEPARATOR_CLASS), list);
  return card;
}

const cards = new Map<string, Tooltip>();

function fieldCard(state: EditorState): Tooltip | null {
  const stack = state.field(snippetSessionField, false);
  const top = stack?.at(-1);
  const field = top?.fields[top.active];
  if (!stack || !top || !field || field.index === 0) return null;
  const numbered = top.fields.filter((candidate) => candidate.index !== 0);
  const current = numbered.indexOf(field) + 1;
  const pos = field.ranges[0].from;
  const key = `${pos}:${current}:${numbered.length}`;
  let card = cards.get(key);
  if (!card) {
    cards.clear();
    card = { pos, above: true, arrow: true, create: () => ({ dom: fieldCardDom(current, numbered.length) }) };
    cards.set(key, card);
  }
  return card;
}

const fieldCardTooltip = showTooltip.compute([snippetSessionField], fieldCard);

const sessionExtension: Extension = [
  snippetSessionField,
  decorations,
  fieldCardTooltip,
  mirrorFilter,
  sessionHistory,
  compositionSync,
  snippetFlashField,
  snippetSessionTheme,
  EditorState.languageData.of(() => [{ autocomplete: snippetFieldCompletions }]),
  Prec.highest(keymap.of([{ key: "Escape", run: endSnippetSession }])),
];

export function snippetSessionExtension(): Extension {
  return sessionExtension;
}

const fallbackFieldKeys: Extension = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      run: (view) => !vimOwnsInput(view) && nextSnippetField(view),
      shift: (view) => !vimOwnsInput(view) && previousSnippetField(view),
    },
  ]),
);

export function snippetSessionInstall(state: EditorState): StateEffect<unknown>[] {
  return state.field(snippetSessionField, false) === undefined
    ? [StateEffect.appendConfig.of([sessionExtension, fallbackFieldKeys])]
    : [];
}

export function needsSnippetSession(rendered: Pick<Rendered, "fields" | "mirrors">): boolean {
  const { fields, mirrors } = rendered;
  return (
    fields.some((field) => field.index !== 0) ||
    mirrors.some((mirror) => fields.some((field) => field.index === mirror.source))
  );
}

function offsetField(field: FieldSpec, offset: number): ActiveField {
  return {
    index: field.index,
    ranges: field.ranges.map((range) => ({ from: range.from + offset, to: range.to + offset })),
    ...(field.choices ? { choices: field.choices } : {}),
    ...(field.project ? { project: field.project } : {}),
  };
}

export function snippetSessionFor(recordId: string, rendered: Rendered, offset: number): SnippetSession {
  return {
    recordId,
    fields: rendered.fields.map((field) => offsetField(field, offset)),
    mirrors: rendered.mirrors.map((mirror) => ({ ...mirror, from: mirror.from + offset, to: mirror.to + offset })),
    active: 0,
    exit: rendered.exit + offset,
  };
}

export function firstFieldSelection(session: SnippetSession): EditorSelection {
  return fieldSelection(session.fields[0]);
}

export function firstFieldOffersList(session: SnippetSession): boolean {
  return offersList(session.fields[0]);
}

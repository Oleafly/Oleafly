import { createContext, type FC, type KeyboardEvent, type ReactNode, useContext, useEffect, useId, useRef, useState } from "react";
import { type EditorMessageKey, editorMessage } from "../../../messages";
import type { TextRange } from "../../../typst-arguments";
import type { TypstFieldKind, TypstFormField } from "../../../typst-forms";
import type { CommitResult } from "./commit";
import {
  canClear,
  type FieldEdit,
  type FieldState,
  type FieldValue,
  type FormCallModel,
  type NumberProblem,
  numberProblem,
  type ReadOnlyReason,
} from "./model";

export type HistoryCommand = "undo" | "redo";

export interface FormFieldsProps {
  readonly model: FormCallModel;
  readonly readOnly: boolean;
  onCommit(field: number, edit: FieldEdit): Promise<CommitResult>;
  onReveal(range: TextRange): void;
  // Undo or redo in the document, for a history key pressed where the field has no typing of its own to undo.
  onHistory(command: HistoryCommand): void;
}

// Each save a field starts when it loses focus, resolving false when a problem keeps its draft.
// The chip's popover listens, so it stays open until a draft it would close over is written.
export const FormSaves = createContext<((save: Promise<boolean>) => void) | null>(null);

const SUMMARY_LENGTH = 40;
const graphemes =
  typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

// User-perceived characters, or code points where the engine has no segmenter.
function* characters(line: string): Generator<string> {
  if (!graphemes) {
    yield* line;
    return;
  }
  for (const { segment } of graphemes.segment(line)) yield segment;
}

// Cut by character, so an emoji or an accented letter is never split.
export function shortSummary(summary: string | null): string | null {
  if (summary === null) return null;
  const line = summary.replaceAll(/\s+/gu, " ").trim();
  if (line === "") return null;
  if (line.length <= SUMMARY_LENGTH) return line;
  const kept: string[] = [];
  for (const character of characters(line)) {
    if (kept.length === SUMMARY_LENGTH) return `${kept.slice(0, -1).join("").trimEnd()}…`;
    kept.push(character);
  }
  return line;
}

// Mod-Z, Mod-Shift-Z and Mod-Y, the same keys the app's history handler leaves to the form.
export function historyCommand(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): HistoryCommand | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  return key === "y" ? "redo" : null;
}

// An Enter or Escape that confirms or cancels an IME candidate belongs to the IME. WebKit sends
// that key after compositionend, with keyCode 229 and isComposing false.
function composing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

type EditingDocument = { execCommand(command: string): boolean };

const REASONS: Record<ReadOnlyReason, EditorMessageKey> = {
  expression: "visual.typst.forms.reason.expression",
  kind: "visual.typst.forms.reason.kind",
  unknownOption: "visual.typst.forms.reason.unknownOption",
  locked: "visual.typst.forms.reason.locked",
};

type Problem = "invalid" | "refused" | "readOnly" | NumberProblem | null;

interface ControlProps {
  readonly id: string;
  readonly field: TypstFormField;
  readonly state: FieldState;
  readonly disabled: boolean;
  commit(edit: FieldEdit): Promise<CommitResult>;
  report(problem: Problem): void;
  onHistory(command: HistoryCommand): void;
}

function committedText(state: FieldState): string {
  if (state.status !== "value") return "";
  return typeof state.value.value === "string" ? state.value.value : String(state.value.value);
}

function defaultText(field: TypstFormField): string | null {
  const kind = field.kind;
  if (kind.type === "content" || kind.default === null) return null;
  if (kind.type === "choice") return kind.options.find((option) => option.value === kind.default)?.label ?? kind.default;
  if (kind.type === "toggle") return editorMessage(kind.default ? "visual.typst.forms.on" : "visual.typst.forms.off");
  return String(kind.default);
}

function problemFor(result: CommitResult): Problem {
  if (result.ok || result.reason === "stale") return null;
  return result.reason;
}

function rangeMessage(kind: TypstFieldKind): string {
  if (kind.type !== "number") return editorMessage("visual.typst.forms.invalid");
  const { min, max } = kind;
  if (min !== null && max !== null) return editorMessage("visual.typst.forms.between", { min: String(min), max: String(max) });
  if (min !== null) return editorMessage("visual.typst.forms.atLeast", { min: String(min) });
  return editorMessage("visual.typst.forms.atMost", { max: String(max) });
}

const PROBLEM_MESSAGES: Record<"invalid" | "readOnly" | "number", EditorMessageKey> = {
  invalid: "visual.typst.forms.invalid",
  readOnly: "visual.typst.forms.readOnly",
  number: "visual.typst.forms.invalidNumber",
};

function problemMessage(problem: Exclude<Problem, null | "refused">, field: TypstFormField): string {
  return problem === "range" ? rangeMessage(field.kind) : editorMessage(PROBLEM_MESSAGES[problem]);
}

// A history key in a control with nothing of its own to undo goes to the document.
function historyKeyDown(event: KeyboardEvent, onHistory: (command: HistoryCommand) => void): boolean {
  const command = historyCommand(event);
  if (!command) return false;
  event.preventDefault();
  onHistory(command);
  return true;
}

type NumberKind = Extract<TypstFieldKind, { type: "number" }>;

// ArrowUp and ArrowDown step by the field's `step` (1 when it has none), within min and max.
// An empty field starts at its default, its minimum or 0.
export function steppedNumber(kind: NumberKind, text: string, direction: 1 | -1): string | null {
  if (text.trim() === "") return String(kind.default ?? kind.min ?? 0);
  const current = Number(text);
  if (!Number.isFinite(current)) return null;
  let next = Number.parseFloat((current + direction * (kind.step ?? 1)).toPrecision(12));
  if (kind.integer) next = Math.round(next);
  if (kind.min !== null) next = Math.max(kind.min, next);
  if (kind.max !== null) next = Math.min(kind.max, next);
  return String(next);
}

// Text, content and number fields keep a draft until Enter (Mod-Enter in multi-line
// fields), focus leaving the field, or a mousedown outside the form commits it. Escape
// puts the committed value back.
const DraftControl: FC<ControlProps & { readonly multiline: boolean }> = ({
  id,
  field,
  state,
  disabled,
  multiline,
  commit,
  report,
  onHistory,
}) => {
  const committed = committedText(state);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? committed;
  const kind = field.kind;
  const element = useRef<HTMLElement | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const track = useContext(FormSaves);
  const dirty = draft !== null && draft !== committed;

  const edit = (text: string): FieldEdit | Exclude<Problem, null> => {
    if (kind.type === "number") {
      if (text.trim() === "") return canClear(field, state) ? { clear: true } : "number";
      const number = Number(text);
      return numberProblem(kind, number) ?? { set: { type: "number", value: number } };
    }
    const type = kind.type === "content" ? "content" : "text";
    return { set: { type, value: text } as FieldValue };
  };

  // A mousedown outside the form and the blur that follows it must commit once, so a second
  // call while the first is in flight gets the same answer.
  const save = (): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (draft === null) return Promise.resolve(true);
    if (draft === committed) {
      setDraft(null);
      return Promise.resolve(true);
    }
    const next = edit(draft);
    if (typeof next === "string") {
      report(next);
      return Promise.resolve(false);
    }
    const pending = commit(next)
      .then((result) => {
        const problem = problemFor(result);
        report(problem);
        if (!problem) setDraft(null);
        return problem === null;
      })
      .finally(() => {
        saving.current = null;
      });
    saving.current = pending;
    return pending;
  };
  const latestSave = useRef(save);
  latestSave.current = save;
  const editing = draft !== null;

  useEffect(() => {
    if (!editing) return undefined;
    const onMouseDown = (event: MouseEvent) => {
      const form = element.current?.closest(".ofl-visual-form-fields");
      if (form && !form.contains(event.target as Node)) void latestSave.current();
    };
    // CodeMirror drops a card once it scrolls far enough away, and the draft with it. Focus
    // leaves the field, which commits it, as soon as the field is out of the editor's view.
    const onScroll = () => {
      const node = element.current;
      const scroller = node?.closest(".cm-scroller");
      if (!node || !scroller || node !== document.activeElement) return;
      const box = node.getBoundingClientRect();
      const visible = scroller.getBoundingClientRect();
      if (box.bottom < visible.top || box.top > visible.bottom) node.blur();
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [editing]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (composing(event)) return;
    const command = historyCommand(event);
    if (command) {
      // Typing not yet committed is undone in the field itself; anything else is the document's.
      event.preventDefault();
      if (dirty) (document as unknown as EditingDocument).execCommand(command);
      else onHistory(command);
      return;
    }
    if (event.key === "Escape" && draft !== null) {
      event.preventDefault();
      setDraft(null);
      report(null);
    } else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    } else if (kind.type === "number" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const stepped = steppedNumber(kind, value, event.key === "ArrowUp" ? 1 : -1);
      if (stepped === null) return;
      event.preventDefault();
      setDraft(stepped);
      report(null);
    }
  };

  const shared = {
    id,
    ref: (node: HTMLElement | null) => {
      element.current = node;
    },
    className: "ofl-visual-form-input",
    value,
    disabled,
    placeholder: field.placeholder ?? defaultText(field) ?? undefined,
    "data-ofl-form-draft": dirty ? "" : undefined,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => {
      const pending = save();
      track?.(pending);
    },
    onKeyDown,
  };
  if (multiline) return <textarea {...shared} rows={Math.min(8, Math.max(2, value.split("\n").length))} />;
  if (kind.type === "number") {
    // A text field: a number input reads text such as "2,5" or "3e" as empty on some engines,
    // which would clear the argument, and in WebView2 the mouse wheel changes a focused one.
    return (
      <input
        {...shared}
        type="text"
        className="ofl-visual-form-input ofl-visual-form-number"
        inputMode={kind.integer ? "numeric" : "decimal"}
        autoComplete="off"
        spellCheck={false}
      />
    );
  }
  return <input {...shared} type="text" />;
};

const ChoiceControl: FC<ControlProps> = ({ id, field, state, disabled, commit, report, onHistory }) => {
  const kind = field.kind;
  if (kind.type !== "choice") return null;
  const current = state.status === "value" ? committedText(state) : "";
  const fallback = defaultText(field);
  const unset = fallback
    ? editorMessage("visual.typst.forms.notSetDefault", { value: fallback })
    : editorMessage("visual.typst.forms.notSet");
  // "Not set" is offered only when choosing it can remove the argument.
  const clearable = !field.required && "named" in field.arg;
  return (
    <select
      id={id}
      className="ofl-visual-form-input"
      value={current}
      disabled={disabled}
      data-unset={current === "" ? "" : undefined}
      onKeyDown={(event) => historyKeyDown(event, onHistory)}
      onChange={(event) => {
        const next = event.target.value;
        const edit: FieldEdit = next === "" ? { clear: true } : { set: { type: "choice", value: next } };
        void commit(edit).then((result) => report(problemFor(result)));
      }}
    >
      {(clearable || current === "") && (
        <option value="" disabled={!clearable}>
          {field.required ? editorMessage("visual.typst.forms.missing") : unset}
        </option>
      )}
      {kind.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

const ToggleControl: FC<ControlProps> = ({ id, field, state, disabled, commit, report, onHistory }) => {
  const kind = field.kind;
  const checked = state.status === "value" ? state.value.value === true : kind.type === "toggle" && kind.default === true;
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="ofl-visual-form-switch"
      checked={checked}
      aria-checked={checked}
      disabled={disabled}
      onKeyDown={(event) => historyKeyDown(event, onHistory)}
      onChange={(event) => {
        void commit({ set: { type: "toggle", value: event.target.checked } }).then((result) => report(problemFor(result)));
      }}
    />
  );
};

const FieldRow: FC<{
  readonly field: TypstFormField;
  readonly state: FieldState;
  readonly readOnly: boolean;
  readonly callRange: TextRange;
  commit(edit: FieldEdit): Promise<CommitResult>;
  onReveal(range: TextRange): void;
  onHistory(command: HistoryCommand): void;
}> = ({ field, state, readOnly, callRange, commit, onReveal, onHistory }) => {
  const id = useId();
  const [problem, setProblem] = useState<Problem>(null);
  const kind = field.kind;
  const controlProps: ControlProps = { id, field, state, disabled: readOnly, commit, report: setProblem, onHistory };
  let control: ReactNode;
  if (state.status === "readonly") {
    control = state.source ? (
      <code className="ofl-visual-form-source">{state.source}</code>
    ) : (
      <span className="ofl-visual-form-empty" aria-hidden="true" />
    );
  } else if (kind.type === "choice") {
    control = <ChoiceControl {...controlProps} />;
  } else if (kind.type === "toggle") {
    control = <ToggleControl {...controlProps} />;
  } else {
    const multiline = kind.type === "content" || (kind.type === "text" && kind.multiline);
    control = <DraftControl {...controlProps} multiline={multiline} />;
  }
  const missing = state.status === "absent" && field.required;
  const fallback = state.status === "absent" && !field.required && kind.type !== "choice" ? defaultText(field) : null;
  // A read-only document never shows its source in Visual mode, so the reveal actions would do nothing.
  const revealable = !readOnly;
  return (
    <div className="ofl-visual-form-field" data-field-kind={kind.type} data-field-status={state.status}>
      <label className="ofl-visual-form-label" htmlFor={id}>
        {field.label}
      </label>
      <div className="ofl-visual-form-value">
        <div className="ofl-visual-form-control">{control}</div>
        {state.status === "readonly" && (
          <div className="ofl-visual-form-hint">
            {editorMessage(REASONS[state.reason])}
            {state.reason !== "locked" && revealable && (
              <button type="button" className="ofl-visual-form-action" onClick={() => onReveal(state.node)}>
                {editorMessage("visual.typst.forms.editInSource")}
              </button>
            )}
          </div>
        )}
        {missing && <div className="ofl-visual-form-hint ofl-visual-form-missing">{editorMessage("visual.typst.forms.missing")}</div>}
        {fallback && (
          <div className="ofl-visual-form-hint">{editorMessage("visual.typst.forms.defaultValue", { value: fallback })}</div>
        )}
        {field.help && <div className="ofl-visual-form-hint">{field.help}</div>}
        {problem === "refused" && (
          <output className="ofl-visual-form-problem">
            {editorMessage("visual.typst.forms.refused")}
            {revealable && (
              <button type="button" className="ofl-visual-form-action" onClick={() => onReveal(callRange)}>
                {editorMessage("visual.typst.forms.addInSource")}
              </button>
            )}
          </output>
        )}
        {problem && problem !== "refused" && (
          <output className="ofl-visual-form-problem">{problemMessage(problem, field)}</output>
        )}
      </div>
      <div className="ofl-visual-form-actions">
        {canClear(field, state) && !readOnly && (
          <button
            type="button"
            className="ofl-visual-form-action"
            onClick={() =>
              void commit({ clear: true }).then((result) => {
                setProblem(problemFor(result));
                // The button goes away with the value, so focus moves to the field instead of the page.
                if (result.ok) document.getElementById(id)?.focus({ preventScroll: true });
              })
            }
          >
            {editorMessage("visual.typst.forms.clear")}
          </button>
        )}
      </div>
    </div>
  );
};

function fieldKey(field: TypstFormField): string {
  return "named" in field.arg ? `n:${field.arg.named}` : `p:${field.arg.positional}`;
}

export const FormFields: FC<FormFieldsProps> = ({ model, readOnly, onCommit, onReveal, onHistory }) => (
  <div className="ofl-visual-form-fields">
    {model.definition.fields.map((field, index) => (
      <FieldRow
        key={fieldKey(field)}
        field={field}
        state={model.fields[index]}
        readOnly={readOnly}
        callRange={model.range}
        commit={(edit) => onCommit(index, edit)}
        onReveal={onReveal}
        onHistory={onHistory}
      />
    ))}
  </div>
);

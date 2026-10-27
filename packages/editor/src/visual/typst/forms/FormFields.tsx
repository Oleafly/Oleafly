import { type FC, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
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

export interface FormFieldsProps {
  readonly model: FormCallModel;
  readonly readOnly: boolean;
  onCommit(field: number, edit: FieldEdit): Promise<CommitResult>;
  onReveal(range: TextRange): void;
}

const SUMMARY_LENGTH = 40;

export function shortSummary(summary: string | null): string | null {
  if (summary === null) return null;
  const line = summary.replaceAll(/\s+/gu, " ").trim();
  if (line === "") return null;
  return line.length > SUMMARY_LENGTH ? `${line.slice(0, SUMMARY_LENGTH - 1).trimEnd()}…` : line;
}

const REASONS: Record<ReadOnlyReason, EditorMessageKey> = {
  expression: "visual.typst.forms.reason.expression",
  kind: "visual.typst.forms.reason.kind",
  unknownOption: "visual.typst.forms.reason.unknownOption",
  locked: "visual.typst.forms.reason.locked",
};

type Problem = "invalid" | "refused" | NumberProblem | null;

interface ControlProps {
  readonly id: string;
  readonly field: TypstFormField;
  readonly state: FieldState;
  readonly disabled: boolean;
  commit(edit: FieldEdit): Promise<CommitResult>;
  report(problem: Problem): void;
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

function problemMessage(problem: Exclude<Problem, null | "refused">, field: TypstFormField): string {
  if (problem === "range") return rangeMessage(field.kind);
  return editorMessage(problem === "number" ? "visual.typst.forms.invalidNumber" : "visual.typst.forms.invalid");
}

// Text, content and number fields keep a draft until Enter (Mod-Enter in multi-line
// fields), focus leaving the field, or a mousedown outside the form commits it. Escape
// puts the committed value back.
const DraftControl: FC<ControlProps & { readonly multiline: boolean }> = ({ id, field, state, disabled, multiline, commit, report }) => {
  const committed = committedText(state);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? committed;
  const kind = field.kind;
  const element = useRef<HTMLElement | null>(null);
  const saving = useRef(false);

  const edit = (text: string): FieldEdit | Exclude<Problem, null> => {
    if (kind.type === "number") {
      if (text.trim() === "") return canClear(field, state) ? { clear: true } : "number";
      const number = Number(text);
      return numberProblem(kind, number) ?? { set: { type: "number", value: number } };
    }
    const type = kind.type === "content" ? "content" : "text";
    return { set: { type, value: text } as FieldValue };
  };

  // A mousedown outside the form and the blur that follows it must commit once.
  const save = async () => {
    if (draft === null || saving.current) return;
    if (draft === committed) {
      setDraft(null);
      return;
    }
    const next = edit(draft);
    if (typeof next === "string") {
      report(next);
      return;
    }
    saving.current = true;
    try {
      const problem = problemFor(await commit(next));
      report(problem);
      if (!problem) setDraft(null);
    } finally {
      saving.current = false;
    }
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
    window.addEventListener("mousedown", onMouseDown, true);
    return () => window.removeEventListener("mousedown", onMouseDown, true);
  }, [editing]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Escape" && draft !== null) {
      event.preventDefault();
      setDraft(null);
      report(null);
    } else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
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
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => void save(),
    onKeyDown,
  };
  if (multiline) return <textarea {...shared} rows={Math.min(8, Math.max(2, value.split("\n").length))} />;
  if (kind.type === "number") {
    return (
      <input
        {...shared}
        type="number"
        inputMode={kind.integer ? "numeric" : "decimal"}
        min={kind.min ?? undefined}
        max={kind.max ?? undefined}
        step={kind.step ?? (kind.integer ? 1 : "any")}
      />
    );
  }
  return <input {...shared} type="text" />;
};

const ChoiceControl: FC<ControlProps> = ({ id, field, state, disabled, commit, report }) => {
  const kind = field.kind;
  if (kind.type !== "choice") return null;
  const current = state.status === "value" ? committedText(state) : "";
  const fallback = defaultText(field);
  const unset = fallback
    ? editorMessage("visual.typst.forms.notSetDefault", { value: fallback })
    : editorMessage("visual.typst.forms.notSet");
  return (
    <select
      id={id}
      className="ofl-visual-form-input"
      value={current}
      disabled={disabled}
      data-unset={current === "" ? "" : undefined}
      onChange={(event) => {
        const next = event.target.value;
        const edit: FieldEdit = next === "" ? { clear: true } : { set: { type: "choice", value: next } };
        void commit(edit).then((result) => report(problemFor(result)));
      }}
    >
      {(!field.required || current === "") && (
        <option value="" disabled={field.required}>
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

const ToggleControl: FC<ControlProps> = ({ id, field, state, disabled, commit, report }) => {
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
}> = ({ field, state, readOnly, callRange, commit, onReveal }) => {
  const id = useId();
  const [problem, setProblem] = useState<Problem>(null);
  const kind = field.kind;
  const controlProps: ControlProps = { id, field, state, disabled: readOnly, commit, report: setProblem };
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
            {state.reason !== "locked" && (
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
          <div className="ofl-visual-form-problem" role="status">
            {editorMessage("visual.typst.forms.refused")}
            <button type="button" className="ofl-visual-form-action" onClick={() => onReveal(callRange)}>
              {editorMessage("visual.typst.forms.addInSource")}
            </button>
          </div>
        )}
        {problem && problem !== "refused" && (
          <div className="ofl-visual-form-problem" role="status">
            {problemMessage(problem, field)}
          </div>
        )}
      </div>
      <div className="ofl-visual-form-actions">
        {canClear(field, state) && !readOnly && (
          <button
            type="button"
            className="ofl-visual-form-action"
            onClick={() => void commit({ clear: true }).then((result) => setProblem(problemFor(result)))}
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

export const FormFields: FC<FormFieldsProps> = ({ model, readOnly, onCommit, onReveal }) => (
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
      />
    ))}
  </div>
);

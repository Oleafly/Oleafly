import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { Trash2 } from "lucide-react";
import { type CSSProperties, type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { EditorPopover } from "./EditorPopover";
import {
  fieldKey,
  fieldKeyLabel,
  fieldKind,
  fieldValue,
  isDateKey,
  isoDate,
  newField,
  PRIORITY_KEY,
  priorityLabel,
  priorityOf,
  setFieldOpener,
  validFieldKey,
  validFieldValue,
  type FieldAttrs,
  type Priority,
} from "./note-fields";
import { useNotesWeekStart } from "./daily-note";
import { localDate } from "./note-templates";
import { menuPlacement, type MenuSize } from "./SuggestionListbox";

const POPOVER: MenuSize = { width: 264, height: 380 };
const PRIORITY_CHOICES: readonly Priority[] = ["high", "medium", "low"];

interface Editing {
  pos: number;
  attrs: FieldAttrs;
}

function fieldAt(editor: Editor, pos: number): FieldAttrs | null {
  const node = editor.state.doc.nodeAt(pos);
  return node?.type.name === "noteField" ? (node.attrs as FieldAttrs) : null;
}

function removalEnd(editor: Editor, pos: number): number {
  const { doc } = editor.state;
  const $pos = doc.resolve(pos);
  const before = $pos.parentOffset === 0 ? " " : doc.textBetween(pos - 1, pos, undefined, "￼");
  const after = pos + 1 < $pos.end() ? doc.textBetween(pos + 1, pos + 2, undefined, "￼") : "";
  return before === " " && after === " " ? pos + 2 : pos + 1;
}

function TextFieldForm({ attrs, onSave }: Readonly<{ attrs: FieldAttrs; onSave: (attrs: FieldAttrs) => void }>) {
  const { t } = useTranslation(["notes"]);
  const [key, setKey] = useState(attrs.key.trim());
  const [value, setValue] = useState(fieldValue(attrs.value));
  const ids = { key: useId(), value: useId(), hint: useId() };
  const valueOk = validFieldValue(value);
  const valid = validFieldKey(key) && valueOk;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSave(newField(key, value));
  };
  return (
    <form className="flex flex-col gap-2 p-3" onSubmit={submit}>
      <label htmlFor={ids.key} className="text-xs text-muted-foreground">
        {t(($) => $.notes.fields.editor.key)}
      </label>
      <Input id={ids.key} value={key} onChange={(event) => setKey(event.target.value)} className="h-8" aria-invalid={!validFieldKey(key)} />
      <label htmlFor={ids.value} className="text-xs text-muted-foreground">
        {t(($) => $.notes.fields.editor.value)}
      </label>
      <Input
        id={ids.value}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-8"
        aria-invalid={!valueOk}
        aria-describedby={valueOk ? undefined : ids.hint}
        autoFocus
      />
      {!valueOk && (
        <p id={ids.hint} className="text-xs text-destructive">
          {t(($) => $.notes.fields.editor.brackets)}
        </p>
      )}
      <Button type="submit" size="sm" disabled={!valid}>
        {t(($) => $.notes.fields.editor.save)}
      </Button>
    </form>
  );
}

export function NoteFieldPopover({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const weekStartsOn = useNotesWeekStart();

  useEffect(() => {
    if (editor.isDestroyed) return;
    const view = editor.view;
    setFieldOpener(view, (_view, pos) => {
      const attrs = fieldAt(editor, pos);
      if (!attrs) return;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      setStyle(menuPlacement(editor, pos, POPOVER));
      setEditing({ pos, attrs });
    });
    return () => setFieldOpener(view, null);
  }, [editor]);

  const close = useCallback(() => {
    setEditing(null);
    if (!editor.isDestroyed) editor.view.focus();
  }, [editor]);

  if (!editing) return null;
  const { pos, attrs } = editing;
  const apply = (next: FieldAttrs | null) => {
    setEditing(null);
    if (editor.isDestroyed || !fieldAt(editor, pos) || !editor.isEditable) return;
    const tr = next ? editor.state.tr.setNodeMarkup(pos, undefined, next) : editor.state.tr.delete(pos, removalEnd(editor, pos));
    editor.view.dispatch(tr);
    editor.view.focus();
  };
  const kind = fieldKind(attrs);
  const dateLike = kind === "date" || (isDateKey(attrs.key) && fieldValue(attrs.value) === "");
  const priorityLike = fieldKey(attrs.key) === PRIORITY_KEY;
  const selected = isoDate(attrs.value) ?? undefined;
  const current = priorityOf(attrs.value);
  return (
    <EditorPopover
      label={t(($) => $.notes.fields.editor.label, { key: fieldKeyLabel(attrs.key) })}
      data-note-field-editor
      style={style}
      onClose={close}
      className="w-66"
    >
      {dateLike && (
        <Calendar
          mode="single"
          weekStartsOn={weekStartsOn}
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (date) apply({ ...attrs, value: ` ${localDate(date)}` });
          }}
          autoFocus
        />
      )}
      {priorityLike && !dateLike && (
        <div className="flex flex-col gap-0.5 p-1.5">
          {PRIORITY_CHOICES.map((priority) => (
            <Button
              key={priority}
              variant="ghost"
              size="sm"
              data-priority-choice={priority}
              aria-pressed={current === priority}
              className="justify-start aria-pressed:bg-accent"
              onClick={() => apply({ ...attrs, value: ` ${priority}` })}
            >
              {priorityLabel(priority)}
            </Button>
          ))}
        </div>
      )}
      {!dateLike && !priorityLike && <TextFieldForm attrs={attrs} onSave={apply} />}
      <div className="border-t p-1.5">
        <Button variant="ghost" size="sm" className="w-full justify-start text-destructive" onClick={() => apply(null)}>
          <Trash2 aria-hidden />
          {t(($) => $.notes.fields.editor.remove)}
        </Button>
      </div>
    </EditorPopover>
  );
}

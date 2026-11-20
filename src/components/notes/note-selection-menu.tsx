import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { Bold, Code, Italic, Link, Strikethrough, Underline } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Divider, IconBtn } from "@/components/editor/EditorToolbar";
import {
  applyLink,
  currentLinkHref,
  FieldForm,
  returnFocus,
  applyTextColor,
  TextColorMenu,
  textColorOf,
  ToolbarPopover,
} from "@/components/editor/rich-text-controls";
import { useMeasuredBox } from "@/components/ui/selection-placement";
import { type BubbleAnchor, bubblePlace } from "./note-bubble";

const MARKS = [
  { id: "bold", icon: Bold, label: "bold" },
  { id: "italic", icon: Italic, label: "italic" },
  { id: "underline", icon: Underline, label: "underline" },
  { id: "strike", icon: Strikethrough, label: "strikethrough" },
  { id: "code", icon: Code, label: "inlineCode" },
] as const;

function formats(editor: Editor): boolean {
  return editor.isEditable && !editor.isActive("codeBlock") && !(editor.state.selection instanceof NodeSelection);
}

export function NoteSelectionMenu({
  editor,
  anchor,
  onHold,
  children,
}: Readonly<{ editor: Editor; anchor: BubbleAnchor; onHold: (held: boolean) => void; children: ReactNode }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const [ref, box] = useMeasuredBox<HTMLDivElement>();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      ...(Object.fromEntries(MARKS.map(({ id }) => [id, current.isActive(id)])) as Record<(typeof MARKS)[number]["id"], boolean>),
      textColor: textColorOf(current),
      formatting: formats(current),
    }),
  });
  const place = bubblePlace(anchor, { width: window.innerWidth }, box ?? undefined);
  const back = returnFocus(editor);
  const hold = (open: boolean) => {
    onHold(open);
    if (!open && !editor.isDestroyed) editor.view.focus();
  };
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t(($) => $.notes.document.selectionMenu)}
      data-note-selection-bubble
      style={{ top: place.top, left: place.left }}
      onMouseDown={(event) => event.preventDefault()}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
    >
      {state.formatting && (
        <>
          {MARKS.map(({ id, icon: Icon, label }) => (
            <IconBtn key={id} title={t(($) => $.editor.toolbar[label])} active={state[id]} onClick={() => editor.chain().focus().toggleMark(id).run()}>
              <Icon aria-hidden className="size-4" />
            </IconBtn>
          ))}
          <Divider />
          <TextColorMenu onColor={(spec) => applyTextColor(editor, spec)} color={state.textColor} onOpenChange={onHold} onCloseAutoFocus={back} />
          <ToolbarPopover icon={Link} label={t(($) => $.notes.toolbar.link)} menuRow={false} onOpenChange={hold}>
            <FieldForm
              label={t(($) => $.notes.toolbar.linkAddress)}
              placeholder={t(($) => $.notes.toolbar.linkPlaceholder)}
              initial={() => currentLinkHref(editor)}
              invalidText={t(($) => $.notes.toolbar.linkInvalid)}
              removeLabel={t(($) => $.editor.toolbar.removeLink)}
              onApply={(value) => applyLink(editor, value)}
            />
          </ToolbarPopover>
          <Divider />
        </>
      )}
      {children}
    </div>
  );
}

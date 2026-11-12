import type { Editor } from "@tiptap/react";
import { Eraser, Highlighter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { MENU_ICON, ToolbarMenuButton, ToolbarMenuKeys, ToolbarSubMenu } from "@/components/ui/toolbar-overflow";
import { NOTES_HIGHLIGHT_COLORS, type NotesHighlightColor } from "@/lib/notes-appearance";
import { cn } from "@/lib/utils";
import { useNotesPrefsStore } from "@/store/notes-prefs";

function HighlightSwatch({ color, className }: Readonly<{ color: NotesHighlightColor; className?: string }>) {
  return <span aria-hidden data-color={color} className={cn("note-highlight block size-3.5 shrink-0 rounded-sm p-0", className)} />;
}

export function HighlightMenu({
  editor,
  color,
  keys,
  inMenu = false,
  onCloseAutoFocus,
}: Readonly<{
  editor: Editor;
  color: NotesHighlightColor | null;
  keys: string;
  inMenu?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
}>) {
  const { t } = useTranslation(["notes", "editor"]);
  const last = useNotesPrefsStore((state) => state.highlightColor);
  const label = t(($) => $.editor.toolbar.highlight);
  const items = (
    <>
      {NOTES_HIGHLIGHT_COLORS.map((option) => (
        <DropdownMenuCheckboxItem
          key={option}
          checked={color === option}
          onSelect={() => editor.chain().focus().toggleHighlight(option).run()}
          className="gap-2"
        >
          <HighlightSwatch color={option} />
          {t(($) => $.notes.highlight.colors[option])}
          {option === last && <ToolbarMenuKeys keys={keys} />}
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={color === null} onSelect={() => editor.chain().focus().unsetHighlight().run()}>
        <Eraser aria-hidden className={MENU_ICON} />
        {t(($) => $.notes.highlight.remove)}
      </DropdownMenuItem>
    </>
  );
  if (inMenu) {
    return (
      <ToolbarSubMenu icon={Highlighter} label={label}>
        {items}
      </ToolbarSubMenu>
    );
  }
  return (
    <ToolbarMenuButton
      label={label}
      active={color !== null}
      onCloseAutoFocus={onCloseAutoFocus}
      icon={
        <span className="relative flex">
          <Highlighter aria-hidden className="size-4" />
          <HighlightSwatch color={last} className="absolute inset-x-0 -bottom-1 h-1 w-auto rounded-full" />
        </span>
      }
    >
      {items}
    </ToolbarMenuButton>
  );
}

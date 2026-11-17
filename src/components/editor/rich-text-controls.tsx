import type { Editor } from "@tiptap/core";
import { latexColorToCss } from "@oleafly/latex";
import { type TextAlign, textAlignOf } from "@oleafly/wysiwyg/text-align-values";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Eraser, type LucideIcon, Smile } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Button } from "@/components/ui/button";
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { MENU_ICON, ToolbarMenuButton, ToolbarMenuHost, ToolbarSubMenu } from "@/components/ui/toolbar-overflow";
import { Tooltip } from "@/components/ui/tooltip";
import { i18n } from "@/i18n";
import { EmojiChooser } from "./emoji-chooser";

export const TEXT_COLORS = [
  { id: "gray", spec: "gray" },
  { id: "red", spec: "red!85!black" },
  { id: "orange", spec: "orange!75!black" },
  { id: "green", spec: "green!60!black" },
  { id: "teal", spec: "teal" },
  { id: "blue", spec: "cyan!40!blue!85!black" },
  { id: "purple", spec: "magenta!70!black" },
] as const;

export const ALIGNMENTS: readonly { align: TextAlign; icon: LucideIcon; label: () => string }[] = [
  { align: "left", icon: AlignLeft, label: () => i18n.t(($) => $.editor.toolbar.align.left) },
  { align: "center", icon: AlignCenter, label: () => i18n.t(($) => $.editor.toolbar.align.center) },
  { align: "right", icon: AlignRight, label: () => i18n.t(($) => $.editor.toolbar.align.right) },
  { align: "justify", icon: AlignJustify, label: () => i18n.t(($) => $.editor.toolbar.align.justify) },
];

export function returnFocus(editor: Editor): (event: Event) => void {
  return (event) => {
    event.preventDefault();
    if (editor.isDestroyed || editor.view.hasFocus()) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    editor.view.focus();
  };
}

export function textColorOf(editor: Editor): string | null {
  if (!editor.isActive("textColor")) return null;
  const color: unknown = editor.getAttributes("textColor").color;
  return typeof color === "string" && color !== "" ? color : null;
}

export function alignmentOf(editor: Editor): TextAlign {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "paragraph" || node.type.name === "heading") return textAlignOf(node.attrs.textAlign) ?? "left";
  }
  return "left";
}

export function alignText(editor: Editor, align: TextAlign): boolean {
  const chain = editor.chain().focus();
  return (align === "left" ? chain.unsetTextAlign() : chain.setTextAlign(align)).run();
}

export function clearFormatting(editor: Editor): boolean {
  return editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run();
}

export function currentLinkHref(editor: Editor): string {
  const href: unknown = editor.getAttributes("link").href;
  return editor.isActive("link") && typeof href === "string" ? href : "";
}

export function applyLink(editor: Editor, value: string): boolean {
  if (!value) return editor.chain().focus().extendMarkRange("link").unsetLink().run();
  const { empty } = editor.state.selection;
  if (!empty || editor.isActive("link")) return editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
  if (!editor.can().setLink({ href: value })) return false;
  return editor
    .chain()
    .focus()
    .insertContent({ type: "text", text: value, marks: [{ type: "link", attrs: { href: value } }] })
    .unsetMark("link")
    .run();
}

export function FieldForm({
  label,
  placeholder,
  initial,
  allowEmpty,
  invalidText,
  removeLabel,
  onApply,
  onDone,
}: Readonly<{
  label: string;
  placeholder: string;
  initial: () => string;
  allowEmpty?: boolean;
  invalidText?: string;
  removeLabel?: string;
  onApply: (value: string) => boolean;
  onDone?: () => void;
}>) {
  const [start] = useState(initial);
  const [value, setValue] = useState(start);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const apply = (next: string) => {
    if (!onApply(next)) {
      setInvalid(true);
      return;
    }
    onDone?.();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") return;
    event.stopPropagation();
    if (isImeEnter(event)) return;
    const trimmed = value.trim();
    if (event.key !== "Enter" || (!trimmed && !(allowEmpty ?? start !== ""))) return;
    event.preventDefault();
    apply(trimmed);
  };
  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
      />
      {invalid && invalidText && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {invalidText}
        </p>
      )}
      {removeLabel && start !== "" && (
        <Button variant="ghost" size="sm" className="self-end" onClick={() => apply("")}>
          {removeLabel}
        </Button>
      )}
    </div>
  );
}

export function ToolbarPopover({
  icon: Icon,
  label,
  menuRow,
  className = "w-64 min-w-0 p-2",
  onOpenChange,
  children,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  menuRow: boolean;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}>) {
  const picker = (
    <Popover
      ariaLabel={label}
      closeOnClick={false}
      className={className}
      onOpenChange={onOpenChange}
      triggerClassName={menuRow ? "w-full justify-start gap-2 pr-2 pl-8 text-sm font-normal" : undefined}
      trigger={
        <>
          <Icon aria-hidden className={menuRow ? MENU_ICON : "size-4"} />
          {menuRow && <span className="flex-1 text-left">{label}</span>}
        </>
      }
    >
      {children}
    </Popover>
  );
  if (menuRow) return <ToolbarMenuHost>{picker}</ToolbarMenuHost>;
  return (
    <Tooltip label={label} side="bottom">
      {picker}
    </Tooltip>
  );
}

export function EmojiPopover({ menuRow = false, onPick }: Readonly<{ menuRow?: boolean; onPick: (emoji: string) => void }>) {
  const { t } = useTranslation(["editor"]);
  return (
    <ToolbarPopover icon={Smile} label={t(($) => $.editor.toolbar.emoji)} menuRow={menuRow} className="w-80 min-w-0 p-2">
      <EmojiChooser onSelect={onPick} />
    </ToolbarPopover>
  );
}

function ColorGlyph({ spec }: Readonly<{ spec: string }>) {
  return (
    <Baseline aria-hidden style={{ color: latexColorToCss(spec) ?? undefined }} className="size-4 shrink-0" />
  );
}

export function applyTextColor(editor: Editor, spec: string | null): boolean {
  const chain = editor.chain().focus();
  return (spec === null ? chain.extendMarkRange("textColor").unsetMark("textColor") : chain.setMark("textColor", { color: spec })).run();
}

export function TextColorMenu({
  onColor,
  color,
  inMenu = false,
  onCloseAutoFocus,
  onOpenChange,
}: Readonly<{
  onColor: (spec: string | null) => void;
  color: string | null;
  inMenu?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  onOpenChange?: (open: boolean) => void;
}>) {
  const { t } = useTranslation(["editor"]);
  const label = t(($) => $.editor.toolbar.textColor);
  const items = (
    <>
      {TEXT_COLORS.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.id}
          checked={color === option.spec}
          onSelect={() => onColor(option.spec)}
          className="gap-2"
        >
          <ColorGlyph spec={option.spec} />
          {t(($) => $.editor.toolbar.textColors[option.id])}
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={color === null} onSelect={() => onColor(null)}>
        <Eraser aria-hidden className={MENU_ICON} />
        {t(($) => $.editor.toolbar.removeTextColor)}
      </DropdownMenuItem>
    </>
  );
  if (inMenu) {
    return (
      <ToolbarSubMenu inset icon={Baseline} label={label} active={color !== null}>
        {items}
      </ToolbarSubMenu>
    );
  }
  const css = color === null ? null : latexColorToCss(color);
  return (
    <ToolbarMenuButton
      label={label}
      active={color !== null}
      onCloseAutoFocus={onCloseAutoFocus}
      onOpenChange={onOpenChange}
      icon={<Baseline aria-hidden style={css ? { color: css } : undefined} className="size-4" />}
    >
      {items}
    </ToolbarMenuButton>
  );
}

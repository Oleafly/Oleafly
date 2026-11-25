import { type CommandProps, type Editor, Extension } from "@tiptap/core";
import type { Node as ModelNode, NodeRange } from "@tiptap/pm/model";
import type { EditorState, Selection } from "@tiptap/pm/state";
import { findWrapping, liftTarget } from "@tiptap/pm/transform";
import { latexColorToCss } from "@oleafly/latex";
import { type TextAlign, textAlignOf } from "@oleafly/wysiwyg/text-align-values";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Eraser, type LucideIcon, Smile } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/lib/ime";
import { Button } from "@/components/ui/button";
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input, LITERAL_INPUT } from "@/components/ui/input";
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

export const TASK_MARKER = /^\[[ xX]\](?=\s|$)/u;

interface AlignedBlock {
  pos: number;
  node: ModelNode;
  task: boolean;
}

function opensTask(item: ModelNode, paragraph: ModelNode): boolean {
  if (item.type.name === "taskItem") return item.attrs.task !== false;
  return item.type.name === "listItem" && TASK_MARKER.test(paragraph.textContent);
}

function alignedBlocks(state: EditorState): AlignedBlock[] {
  const blocks: AlignedBlock[] = [];
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent, index) => {
      if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
      const task = node.type.name === "paragraph" && index === 0 && parent !== null && opensTask(parent, node);
      blocks.push({ pos, node, task });
      return false;
    });
  }
  return blocks;
}

export function alignable(editor: Editor): boolean {
  if (editor.isActive("table") || editor.isActive("codeBlock")) return false;
  const blocks = alignedBlocks(editor.state);
  return blocks.length === 0 || blocks.some((block) => !block.task || textAlignOf(block.node.attrs.textAlign) !== null);
}

export function alignText(editor: Editor, align: TextAlign): boolean {
  const chain = editor.chain().focus();
  if (align === "left") return chain.unsetTextAlign().run();
  const blocks = alignedBlocks(editor.state);
  const tasks = blocks.filter((block) => block.task);
  if (tasks.length > 0 && tasks.length === blocks.length) return false;
  return chain
    .setTextAlign(align)
    .command(({ tr }) => {
      for (const { pos, node } of tasks) {
        if (tr.doc.nodeAt(pos)?.attrs.textAlign !== node.attrs.textAlign) tr.setNodeMarkup(pos, undefined, node.attrs);
      }
      return true;
    })
    .run();
}

function insideTable(range: NodeRange): boolean {
  for (let depth = range.depth; depth >= 0; depth -= 1) if (range.$from.node(depth).type.spec.tableRole) return true;
  return false;
}

function blankLeadBefore(range: NodeRange): number | null {
  const depth = range.depth - 1;
  const item = range.$from.node(depth);
  const lead = item.firstChild;
  if (item.type.name !== "listItem" || range.$from.index(depth) !== 1 || range.startIndex !== 0) return null;
  if (lead?.type.name !== "paragraph" || lead.content.size > 0 || range.parent.firstChild?.type.name !== "paragraph") return null;
  return range.$from.start(depth);
}

type QuotePlan = { lift: NodeRange; target: number; lead: number | null } | { wrap: NodeRange; wrapping: NonNullable<ReturnType<typeof findWrapping>> };

function quotePlan({ $from, $to }: Selection): QuotePlan | null {
  const quoted = $from.blockRange($to, (node) => node.type.name === "blockquote");
  if (quoted) {
    const target = liftTarget(quoted);
    return target === null ? null : { lift: quoted, target, lead: target === quoted.depth - 1 ? blankLeadBefore(quoted) : null };
  }
  const range = $from.blockRange($to);
  const blockquote = $from.doc.type.schema.nodes.blockquote;
  const wrapping = range && blockquote && !insideTable(range) ? findWrapping(range, blockquote) : null;
  return range && wrapping ? { wrap: range, wrapping } : null;
}

export function quoteCommand({ tr, dispatch }: CommandProps): boolean {
  const plan = quotePlan(tr.selection);
  if (!plan) return false;
  if (!dispatch) return true;
  if ("wrap" in plan) tr.wrap(plan.wrap, plan.wrapping);
  else {
    tr.lift(plan.lift, plan.target);
    if (plan.lead !== null) tr.delete(plan.lead, plan.lead + 2);
  }
  tr.scrollIntoView();
  return true;
}

export function quotable(editor: Editor): boolean {
  return quotePlan(editor.state.selection) !== null;
}

export function toggleQuote(editor: Editor): boolean {
  return quotable(editor) && editor.chain().focus().command(quoteCommand).run();
}

export const QuoteOrBoldKey = Extension.create({
  name: "quoteOrBoldKey",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-b": () => {
        if (!toggleQuote(this.editor)) this.editor.chain().focus().toggleBold().run();
        return true;
      },
    };
  },
});

export function clearFormatting(editor: Editor): boolean {
  return editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run();
}

export function currentLinkHref(editor: Editor): string {
  const href: unknown = editor.getAttributes("link").href;
  return editor.isActive("link") && typeof href === "string" ? href : "";
}

export function applyLink(editor: Editor, href: string, text = href): boolean {
  if (!href) return editor.chain().focus().extendMarkRange("link").unsetLink().run();
  const { empty } = editor.state.selection;
  if (!empty || editor.isActive("link")) return editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  if (!editor.can().setLink({ href })) return false;
  return editor
    .chain()
    .focus()
    .insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] })
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
        {...LITERAL_INPUT}
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

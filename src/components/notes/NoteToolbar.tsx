import type { Editor } from "@tiptap/core";
import { mathNodeJSON } from "@oleafly/wysiwyg";
import { useEditorState } from "@tiptap/react";
import {
  BetweenHorizontalStart,
  BetweenVerticalStart,
  Bold,
  BookMarked,
  ChartColumn,
  ChevronDown,
  Code,
  FileCode2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTree,
  Network,
  Pilcrow,
  Quote,
  Redo2,
  Sigma,
  SquareCode,
  SquareFunction,
  Strikethrough,
  Table,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Divider, IconBtn } from "@/components/editor/EditorToolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NEW_BLOCKS, newChartSource } from "./block-templates";
import { useNotesData } from "./notes-data";

const HEADINGS: { level: 1 | 2 | 3 | 4; icon: LucideIcon }[] = [
  { level: 1, icon: Heading1 },
  { level: 2, icon: Heading2 },
  { level: 3, icon: Heading3 },
  { level: 4, icon: Heading4 },
];
const TABLE_SIZE = 8;
const TRIGGER =
  "flex h-7 w-auto items-center justify-center gap-0.5 rounded px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent data-[state=open]:bg-accent";
const EMPTY_ITEM = "px-2 py-1.5 text-xs text-muted-foreground";

function MenuButton({
  label,
  active,
  icon,
  children,
}: Readonly<{ label: string; active?: boolean; icon: ReactNode; children: ReactNode }>) {
  return (
    <DropdownMenu>
      <Tooltip label={label} side="bottom">
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={label} className={cn(TRIGGER, active && "bg-primary/10 text-foreground")}>
            {icon}
            <ChevronDown aria-hidden className="size-3" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TablePicker({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const [size, setSize] = useState({ cols: 1, rows: 1 });
  const cells: ReactNode[] = [];
  for (let row = 1; row <= TABLE_SIZE; row++) {
    for (let col = 1; col <= TABLE_SIZE; col++) {
      const lit = row <= size.rows && col <= size.cols;
      cells.push(
        <button
          key={`${row}-${col}`}
          type="button"
          aria-label={t(($) => $.notes.toolbar.tableSize, { cols: col, rows: row })}
          onMouseEnter={() => setSize({ cols: col, rows: row })}
          onFocus={() => setSize({ cols: col, rows: row })}
          onClick={() => editor.chain().focus().insertTable({ rows: row, cols: col, withHeaderRow: true }).run()}
          className={cn("size-4 rounded border bg-muted/40 focus-visible:border-ring", lit && "border-primary/20 bg-primary/10")}
        />,
      );
    }
  }
  return (
    <Popover
      trigger={<Table aria-hidden className="size-4" />}
      ariaLabel={t(($) => $.editor.toolbar.insertTable)}
      align="right"
      triggerClassName={cn(TRIGGER, "w-7 px-0")}
      className="w-auto min-w-0 p-2"
    >
      <div className="grid grid-cols-8 gap-1">{cells}</div>
      <p className="pt-2 text-center text-[0.6875rem] tabular-nums text-muted-foreground">
        {size.cols} × {size.rows}
      </p>
    </Popover>
  );
}

function LinkPicker({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const [href, setHref] = useState("");
  return (
    <Popover
      trigger={<Link aria-hidden className="size-4" />}
      ariaLabel={t(($) => $.notes.toolbar.link)}
      triggerClassName={cn(TRIGGER, "w-7 px-0")}
      closeOnClick={false}
      className="w-64 min-w-0 p-2"
    >
      <Input
        aria-label={t(($) => $.notes.toolbar.linkAddress)}
        placeholder={t(($) => $.notes.toolbar.linkPlaceholder)}
        value={href}
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !href.trim()) return;
          event.preventDefault();
          editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
        }}
      />
    </Popover>
  );
}

function OutlineItems({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const outline = outlineOf(editor);
  if (outline.length === 0) return <p className={EMPTY_ITEM}>{t(($) => $.notes.toolbar.emptyOutline)}</p>;
  return outline.map((item) => (
    <DropdownMenuItem
      key={item.position}
      style={{ paddingInlineStart: `${item.level * 0.5}rem` }}
      onSelect={() => {
        const dom = editor.view.nodeDOM(item.position);
        if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
      }}
    >
      {item.text}
    </DropdownMenuItem>
  ));
}

function outlineOf(editor: Editor): { text: string; level: number; position: number }[] {
  const items: { text: string; level: number; position: number }[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== "heading") return true;
    items.push({ text: node.textContent, level: Number(node.attrs.level), position });
    return false;
  });
  return items;
}

export function NoteToolbar({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const { citations } = useNotesData();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      quote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
      table: current.isActive("table"),
      heading: HEADINGS.find(({ level }) => current.isActive("heading", { level }))?.level ?? null,
      words: current.getText().trim().split(/\s+/u).filter(Boolean).length,
    }),
  });
  const Heading = HEADINGS.find(({ level }) => level === state.heading)?.icon ?? Type;
  const ListIcon = state.ordered ? ListOrdered : List;
  const run = () => editor.chain().focus();
  const insertBlock = (info: string, source: string) =>
    run()
      .insertContent({ type: "codeBlock", attrs: { language: info }, content: [{ type: "text", text: source }] })
      .run();
  const insertMath = (source: string) => {
    const node = mathNodeJSON(source);
    if (node) run().insertContent(node).run();
  };

  return (
    <div
      role="toolbar"
      aria-label={t(($) => $.notes.toolbar.label)}
      className="sticky top-0 z-10 flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-2"
    >
      <IconBtn title={t(($) => $.editor.hotkeys.actions.undo)} disabled={!state.canUndo} onClick={() => run().undo().run()}>
        <Undo2 aria-hidden className="size-4" />
      </IconBtn>
      <IconBtn title={t(($) => $.editor.hotkeys.actions.redo)} disabled={!state.canRedo} onClick={() => run().redo().run()}>
        <Redo2 aria-hidden className="size-4" />
      </IconBtn>
      <Divider />
      <MenuButton
        label={t(($) => $.notes.toolbar.blockType)}
        active={state.heading !== null || state.quote || state.codeBlock}
        icon={<Heading aria-hidden className="size-4" />}
      >
        <DropdownMenuItem onSelect={() => run().setParagraph().run()}>
          <Pilcrow aria-hidden className="size-4" />
          {t(($) => $.notes.toolbar.text)}
        </DropdownMenuItem>
        {HEADINGS.map(({ level, icon: Icon }) => (
          <DropdownMenuItem key={level} onSelect={() => run().setHeading({ level }).run()}>
            <Icon aria-hidden className="size-4" />
            {t(($) => $.notes.toolbar.heading, { level })}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run().toggleBlockquote().run()}>
          <Quote aria-hidden className="size-4" />
          {t(($) => $.editor.contextMenu.quote)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run().toggleCodeBlock().run()}>
          <SquareCode aria-hidden className="size-4" />
          {t(($) => $.editor.toolbar.codeBlock)}
        </DropdownMenuItem>
      </MenuButton>
      <MenuButton
        label={t(($) => $.notes.toolbar.list)}
        active={state.bullet || state.ordered}
        icon={<ListIcon aria-hidden className="size-4" />}
      >
        <DropdownMenuItem onSelect={() => run().toggleBulletList().run()}>
          <List aria-hidden className="size-4" />
          {t(($) => $.notes.toolbar.bulletList)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run().toggleOrderedList().run()}>
          <ListOrdered aria-hidden className="size-4" />
          {t(($) => $.editor.toolbar.numberedList)}
        </DropdownMenuItem>
      </MenuButton>
      <Divider />
      <IconBtn title={t(($) => $.editor.toolbar.bold)} active={state.bold} onClick={() => run().toggleBold().run()}>
        <Bold aria-hidden className="size-4" />
      </IconBtn>
      <IconBtn title={t(($) => $.editor.toolbar.italic)} active={state.italic} onClick={() => run().toggleItalic().run()}>
        <Italic aria-hidden className="size-4" />
      </IconBtn>
      <IconBtn
        title={t(($) => $.editor.toolbar.strikethrough)}
        active={state.strike}
        onClick={() => run().toggleStrike().run()}
      >
        <Strikethrough aria-hidden className="size-4" />
      </IconBtn>
      <IconBtn title={t(($) => $.editor.toolbar.inlineCode)} active={state.code} onClick={() => run().toggleCode().run()}>
        <Code aria-hidden className="size-4" />
      </IconBtn>
      <LinkPicker editor={editor} />
      <Divider />
      <IconBtn title={t(($) => $.editor.contextMenu.inlineMath)} onClick={() => insertMath("$x^2$")}>
        <Sigma aria-hidden className="size-4" />
      </IconBtn>
      <IconBtn title={t(($) => $.notes.toolbar.displayMath)} onClick={() => insertMath("$$x^2$$")}>
        <SquareFunction aria-hidden className="size-4" />
      </IconBtn>
      <MenuButton label={t(($) => $.notes.toolbar.citation)} icon={<BookMarked aria-hidden className="size-4" />}>
        {citations.length === 0 ? (
          <p className={EMPTY_ITEM}>{t(($) => $.notes.toolbar.noCitations)}</p>
        ) : (
          citations.map((citation) => (
            <DropdownMenuItem key={citation.key} onSelect={() => run().insertContent(`[@${citation.key}]`).run()}>
              {citation.label}
            </DropdownMenuItem>
          ))
        )}
      </MenuButton>
      <Divider />
      <TablePicker editor={editor} />
      <IconBtn title={t(($) => $.notes.toolbar.chart)} onClick={() => insertBlock("chart", newChartSource())}>
        <ChartColumn aria-hidden className="size-4" />
      </IconBtn>
      <IconBtn
        title={t(($) => $.notes.toolbar.mermaid)}
        onClick={() => insertBlock(NEW_BLOCKS.mermaid.info, NEW_BLOCKS.mermaid.source)}
      >
        <Network aria-hidden className="size-4" />
      </IconBtn>
      <MenuButton label={t(($) => $.notes.toolbar.rawBlock)} icon={<FileCode2 aria-hidden className="size-4" />}>
        <DropdownMenuItem onSelect={() => insertBlock(NEW_BLOCKS.latex.info, NEW_BLOCKS.latex.source)}>
          {t(($) => $.notes.toolbar.latexBlock)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => insertBlock(NEW_BLOCKS.typst.info, NEW_BLOCKS.typst.source)}>
          {t(($) => $.notes.toolbar.typstBlock)}
        </DropdownMenuItem>
      </MenuButton>
      {state.table && (
        <>
          <Divider />
          <IconBtn title={t(($) => $.notes.toolbar.addRow)} onClick={() => run().addRowAfter().run()}>
            <BetweenHorizontalStart aria-hidden className="size-4" />
          </IconBtn>
          <IconBtn title={t(($) => $.notes.toolbar.addColumn)} onClick={() => run().addColumnAfter().run()}>
            <BetweenVerticalStart aria-hidden className="size-4" />
          </IconBtn>
          <IconBtn title={t(($) => $.editor.tableToolbar.deleteTable)} onClick={() => run().deleteTable().run()}>
            <Trash2 aria-hidden className="size-4" />
          </IconBtn>
        </>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
        <MenuButton label={t(($) => $.notes.toolbar.outline)} icon={<ListTree aria-hidden className="size-4" />}>
          <OutlineItems editor={editor} />
        </MenuButton>
        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
          {t(($) => $.notes.toolbar.words, { count: state.words })}
        </span>
      </span>
    </div>
  );
}

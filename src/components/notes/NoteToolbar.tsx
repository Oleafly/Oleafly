import type { Editor } from "@tiptap/core";
import { mathNodeJSON } from "@oleafly/wysiwyg";
import { useEditorState } from "@tiptap/react";
import {
  BetweenHorizontalStart,
  BetweenVerticalStart,
  Blocks,
  Bold,
  BookMarked,
  ChartColumn,
  ChevronDown,
  Code,
  Ellipsis,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTree,
  MoveHorizontal,
  Network,
  NotebookTabs,
  Pilcrow,
  Quote,
  RectangleHorizontal,
  RectangleVertical,
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
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Divider, IconBtn } from "@/components/editor/EditorToolbar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import {
  CONTROL_GAP,
  DIVIDER_WIDTH,
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  type ToolbarControl,
  useFittedCount,
} from "@/components/ui/toolbar-overflow";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { describeError } from "@/lib/app-error";
import { notifyError } from "@/lib/toast";
import { cn, shortcut } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import { NEW_BLOCKS, newChartSource } from "./block-templates";
import { blockGroups } from "./block-views";
import type { NoteBlockKind } from "./note-blocks";
import { NOTEBOOK_INFO } from "./notebook-block";
import { NOTE_WIDTHS, saveNoteWidth, useNoteWidth, type NoteWidth } from "./note-prefs";
import { noteWordCount } from "./note-word-count";
import { useNotesData } from "./notes-data";
import { noteIdOf } from "./notes-layout";
import type { CitationItem } from "./types";

const HEADINGS: { level: 1 | 2 | 3 | 4; icon: LucideIcon }[] = [
  { level: 1, icon: Heading1 },
  { level: 2, icon: Heading2 },
  { level: 3, icon: Heading3 },
  { level: 4, icon: Heading4 },
];
const TABLE_SIZE = 8;
const TRIGGER =
  "flex h-7 w-auto shrink-0 items-center justify-center gap-0.5 rounded px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent data-[state=open]:bg-accent";
const EMPTY_ITEM = "px-2 py-1.5 text-xs text-muted-foreground";
const MENU_ICON = "size-4 text-muted-foreground";
const KEYS = { bold: "⌘B", italic: "⌘I", strike: "⌘⇧S", code: "⌘E", bullet: "⌘⇧8", ordered: "⌘⇧7" } as const;
const WORD_WIDTH = 6;
const GROUP_PADDING = 8;

function groupWidth(...widths: number[]): number {
  return widths.reduce((sum, width) => sum + width, 0) + CONTROL_GAP * (widths.length - 1);
}

function returnFocus(editor: Editor): (event: Event) => void {
  return (event) => {
    event.preventDefault();
    if (editor.isDestroyed || editor.view.hasFocus()) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    editor.view.focus();
  };
}

function MenuButton({
  editor,
  label,
  active,
  icon,
  children,
}: Readonly<{ editor: Editor; label: string; active?: boolean; icon: ReactNode; children: ReactNode }>) {
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
      <DropdownMenuContent align="start" onCloseAutoFocus={returnFocus(editor)}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuShortcut({ keys }: Readonly<{ keys: string }>) {
  return <span className="ml-auto pl-4 text-xs tabular-nums text-muted-foreground">{shortcut(keys)}</span>;
}

function CheckItem({
  icon: Icon,
  label,
  keys,
  checked,
  onSelect,
}: Readonly<{ icon: LucideIcon; label: string; keys?: string; checked: boolean; onSelect: () => void }>) {
  return (
    <DropdownMenuCheckboxItem checked={checked} onSelect={onSelect} className="gap-2">
      <Icon aria-hidden className={MENU_ICON} />
      {label}
      {keys && <MenuShortcut keys={keys} />}
    </DropdownMenuCheckboxItem>
  );
}

function ActionItem({ icon: Icon, label, onSelect }: Readonly<{ icon: LucideIcon; label: string; onSelect: () => void }>) {
  return (
    <DropdownMenuItem inset onSelect={onSelect}>
      <Icon aria-hidden className={MENU_ICON} />
      {label}
    </DropdownMenuItem>
  );
}

function SubMenu({
  icon: Icon,
  label,
  children,
  onContentFocus,
}: Readonly<{ icon: LucideIcon; label: string; children: ReactNode; onContentFocus?: () => void }>) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger inset>
        <Icon aria-hidden className={MENU_ICON} />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
          onFocus={(event) => {
            if (event.target === event.currentTarget) onContentFocus?.();
          }}
        >
          {children}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function tableCells(size: { cols: number; rows: number }, cell: (cols: number, rows: number, lit: boolean) => ReactNode) {
  const cells: ReactNode[] = [];
  for (let row = 1; row <= TABLE_SIZE; row++) {
    for (let col = 1; col <= TABLE_SIZE; col++) {
      cells.push(cell(col, row, row <= size.rows && col <= size.cols));
    }
  }
  return cells;
}

function TableSize({ size }: Readonly<{ size: { cols: number; rows: number } }>) {
  return (
    <p className="pt-2 text-center text-[0.6875rem] tabular-nums text-muted-foreground">
      {size.cols} × {size.rows}
    </p>
  );
}

function insertTable(editor: Editor, cols: number, rows: number) {
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
}

function TablePicker({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const [size, setSize] = useState({ cols: 1, rows: 1 });
  const cells = tableCells(size, (cols, rows, lit) => (
    <button
      key={`${rows}-${cols}`}
      type="button"
      aria-label={t(($) => $.notes.toolbar.tableSize, { cols, rows })}
      onMouseEnter={() => setSize({ cols, rows })}
      onFocus={() => setSize({ cols, rows })}
      onClick={() => insertTable(editor, cols, rows)}
      className={cn("size-4 rounded border bg-muted/40 focus-visible:border-ring", lit && "border-primary/20 bg-primary/10")}
    />
  ));
  return (
    <Popover
      trigger={<Table aria-hidden className="size-4" />}
      ariaLabel={t(($) => $.editor.toolbar.insertTable)}
      align="right"
      triggerClassName={cn(TRIGGER, "w-7 px-0")}
      className="w-auto min-w-0 p-2"
    >
      <div className="grid grid-cols-8 gap-1">{cells}</div>
      <TableSize size={size} />
    </Popover>
  );
}

function TableMenu({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const [size, setSize] = useState({ cols: 1, rows: 1 });
  const cells = tableCells(size, (cols, rows, lit) => (
    <DropdownMenuItem
      key={`${rows}-${cols}`}
      aria-label={t(($) => $.notes.toolbar.tableSize, { cols, rows })}
      onFocus={() => setSize({ cols, rows })}
      onSelect={() => insertTable(editor, cols, rows)}
      className={cn(
        "size-4 rounded border bg-muted/40 p-0 focus:border-primary/40 focus:bg-primary/10",
        lit && "border-primary/20 bg-primary/10",
      )}
    />
  ));
  return (
    <SubMenu icon={Table} label={t(($) => $.editor.toolbar.insertTable)}>
      <div className="grid grid-cols-8 gap-1 p-1">{cells}</div>
      <TableSize size={size} />
    </SubMenu>
  );
}

function currentLinkHref(editor: Editor): string {
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

function LinkField({ editor, onDone }: Readonly<{ editor: Editor; onDone?: () => void }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const [linked] = useState(() => currentLinkHref(editor) !== "");
  const [href, setHref] = useState(() => currentLinkHref(editor));
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const apply = (value: string) => {
    if (!applyLink(editor, value)) {
      setInvalid(true);
      return;
    }
    onDone?.();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") return;
    event.stopPropagation();
    if (isImeEnter(event)) return;
    const value = href.trim();
    if (event.key !== "Enter" || (!value && !linked)) return;
    event.preventDefault();
    apply(value);
  };
  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-label={t(($) => $.notes.toolbar.linkAddress)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        placeholder={t(($) => $.notes.toolbar.linkPlaceholder)}
        value={href}
        onChange={(event) => {
          setHref(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
      />
      {invalid && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {t(($) => $.notes.toolbar.linkInvalid)}
        </p>
      )}
      {linked && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => apply("")}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent motion-reduce:transition-none"
          >
            {t(($) => $.editor.toolbar.removeLink)}
          </button>
        </div>
      )}
    </div>
  );
}

function LinkPicker({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <Popover
      trigger={<Link aria-hidden className="size-4" />}
      ariaLabel={t(($) => $.notes.toolbar.link)}
      triggerClassName={cn(TRIGGER, "w-7 px-0")}
      closeOnClick={false}
      className="w-64 min-w-0 p-2"
    >
      <LinkField editor={editor} />
    </Popover>
  );
}

function LinkMenu({ editor, onDone }: Readonly<{ editor: Editor; onDone: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const field = useRef<HTMLDivElement>(null);
  return (
    <SubMenu icon={Link} label={t(($) => $.notes.toolbar.link)} onContentFocus={() => field.current?.querySelector("input")?.focus()}>
      <div ref={field} className="w-64 p-1">
        <LinkField editor={editor} onDone={onDone} />
      </div>
    </SubMenu>
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
        editor.commands.setTextSelection(item.position + 1);
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

type CitationSource = () => Promise<readonly CitationItem[]>;

function useCitationSource(noteId: string | undefined): CitationSource | null {
  const { citations, projectCitations, notes } = useNotesData();
  const related = noteId ? notes.find((note) => note.id === noteId)?.relatedProjectId : undefined;
  return useMemo(() => {
    const known = citations ?? [];
    if (related && projectCitations) {
      return async () => {
        const found = await projectCitations(related).catch(() => []);
        const keys = new Set(found.map((citation) => citation.key));
        return [...found, ...known.filter((citation) => !keys.has(citation.key))];
      };
    }
    return known.length > 0 ? () => Promise.resolve(known) : null;
  }, [citations, projectCitations, related]);
}

function CitationItems({ source, onPick }: Readonly<{ source: CitationSource; onPick: (key: string) => void }>) {
  const { t } = useTranslation(["notes"]);
  const [citations, setCitations] = useState<readonly CitationItem[] | null>(null);
  useEffect(() => {
    let live = true;
    void source().then((found) => {
      if (live) setCitations(found);
    });
    return () => {
      live = false;
    };
  }, [source]);
  if (citations === null) {
    return (
      <p className={EMPTY_ITEM}>
        <Spinner size="xs" />
      </p>
    );
  }
  if (citations.length === 0) return <p className={EMPTY_ITEM}>{t(($) => $.notes.toolbar.noCitations)}</p>;
  return citations.map((citation) => (
    <DropdownMenuItem key={citation.key} onSelect={() => onPick(citation.key)}>
      {citation.label}
    </DropdownMenuItem>
  ));
}

const VIEW_GROUPS: ReadonlySet<string> = new Set(["view", "words"]);

const WIDTH_ICONS: Readonly<Record<NoteWidth, LucideIcon>> = {
  standard: RectangleVertical,
  wide: RectangleHorizontal,
  full: MoveHorizontal,
};

function WidthItems({ width }: Readonly<{ width: NoteWidth }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <>
      <DropdownMenuLabel inset>{t(($) => $.notes.toolbar.width)}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={width}
        onValueChange={(value) => saveNoteWidth(value as NoteWidth)}
      >
        {NOTE_WIDTHS.map((option) => {
          const Icon = WIDTH_ICONS[option];
          return (
            <DropdownMenuRadioItem key={option} value={option}>
              <Icon aria-hidden className={MENU_ICON} />
              {t(($) => $.notes.toolbar.widths[option])}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </>
  );
}

interface ToolbarGroup extends ToolbarControl {
  active?: boolean;
}

function MoreMenu({
  editor,
  groups,
  open,
  onOpenChange,
  pushed,
}: Readonly<{ editor: Editor; groups: readonly ToolbarGroup[]; open: boolean; onOpenChange: (open: boolean) => void; pushed: boolean }>) {
  const { t } = useTranslation(["notes"]);
  const label = t(($) => $.notes.toolbar.more);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <Tooltip label={label} side="bottom" className={cn("shrink-0", pushed && "ml-auto")}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(TRIGGER, "w-7 px-0", groups.some((group) => group.active) && "bg-primary/10 text-foreground")}
          >
            <Ellipsis aria-hidden className="size-4" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={returnFocus(editor)}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-60 overflow-y-auto"
      >
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 && <DropdownMenuSeparator />}
            {group.renderMenu()}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WordCount({ editor, className, as: Tag = "span" }: Readonly<{ editor: Editor; className: string; as?: "span" | "p" }>) {
  const { t } = useTranslation(["notes"]);
  const count = useEditorState({ editor, selector: ({ editor: current }) => noteWordCount(current) });
  return <Tag className={className}>{t(($) => $.notes.toolbar.words, { count })}</Tag>;
}

export function NoteToolbar({ editor, noteId, readOnly = false }: Readonly<{ editor: Editor; noteId?: string; readOnly?: boolean }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const { importNotebook } = useNotesData();
  const citationSource = useCitationSource(noteId);
  const width = useNoteWidth();
  const showWords = useSettingsStore((settings) => settings.notesShowWordCount);
  const [moreOpen, setMoreOpen] = useState(false);
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
      wordDigits: showWords ? String(noteWordCount(current)).length : 0,
    }),
  });
  const Heading = HEADINGS.find(({ level }) => level === state.heading)?.icon ?? Type;
  const ListIcon = state.ordered ? ListOrdered : List;
  const run = () => editor.chain().focus();
  const insertBlock = (info: string, source: string) =>
    run()
      .insertContent({ type: "codeBlock", attrs: { language: info }, content: [{ type: "text", text: source }] })
      .run();
  const insertKind = (kind: NoteBlockKind) => {
    const template = kind.template?.();
    if (template) insertBlock(template.info, template.source);
  };
  const insertNotebook = importNotebook
    ? () => {
        const target = noteId ?? noteIdOf(editor.view.dom.closest("[data-view]")?.getAttribute("data-view"));
        if (!target) return;
        importNotebook(target).then(
          (path) => {
            if (path && !editor.isDestroyed) insertBlock(NOTEBOOK_INFO, path);
          },
          (error: unknown) =>
            notifyError("import notebook", error, t(($) => $.notes.notebook.importFailed, { error: describeError(error) })),
        );
      }
    : null;
  const insertMath = (source: string) => {
    const node = mathNodeJSON(source);
    if (node) run().insertContent(node).run();
  };
  const cite = (key: string) => run().insertContent(`[@${key}]`).run();
  const widestWords = t(($) => $.notes.toolbar.words, { count: 10 ** Math.max(1, state.wordDigits) - 1 });
  const WidthIcon = WIDTH_ICONS[width];
  const marks = [
    { id: "bold", icon: Bold, label: t(($) => $.editor.toolbar.bold), checked: state.bold, toggle: () => run().toggleBold().run() },
    { id: "italic", icon: Italic, label: t(($) => $.editor.toolbar.italic), checked: state.italic, toggle: () => run().toggleItalic().run() },
    {
      id: "strike",
      icon: Strikethrough,
      label: t(($) => $.editor.toolbar.strikethrough),
      checked: state.strike,
      toggle: () => run().toggleStrike().run(),
    },
    { id: "code", icon: Code, label: t(($) => $.editor.toolbar.inlineCode), checked: state.code, toggle: () => run().toggleCode().run() },
  ] as const;
  const lists = [
    { id: "bullet", icon: List, label: t(($) => $.notes.toolbar.bulletList), checked: state.bullet, toggle: () => run().toggleBulletList().run() },
    {
      id: "ordered",
      icon: ListOrdered,
      label: t(($) => $.editor.toolbar.numberedList),
      checked: state.ordered,
      toggle: () => run().toggleOrderedList().run(),
    },
  ] as const;
  const tableTools = [
    { id: "row", icon: BetweenHorizontalStart, label: t(($) => $.notes.toolbar.addRow), run: () => run().addRowAfter().run() },
    { id: "column", icon: BetweenVerticalStart, label: t(($) => $.notes.toolbar.addColumn), run: () => run().addColumnAfter().run() },
    { id: "delete", icon: Trash2, label: t(($) => $.editor.tableToolbar.deleteTable), run: () => run().deleteTable().run() },
  ] as const;

  const allGroups: ToolbarGroup[] = [
    {
      id: "lists",
      width: groupWidth(DIVIDER_WIDTH, DROPDOWN_TRIGGER_WIDTH),
      active: state.bullet || state.ordered,
      render: () => (
        <>
          <Divider />
          <MenuButton
            editor={editor}
            label={t(($) => $.notes.toolbar.list)}
            active={state.bullet || state.ordered}
            icon={<ListIcon aria-hidden className="size-4" />}
          >
            {lists.map(({ id, icon: Icon, label, toggle }) => (
              <DropdownMenuItem key={id} onSelect={toggle}>
                <Icon aria-hidden className="size-4" />
                {label}
              </DropdownMenuItem>
            ))}
          </MenuButton>
        </>
      ),
      renderMenu: () =>
        lists.map(({ id, icon, label, checked, toggle }) => (
          <CheckItem key={id} icon={icon} label={label} keys={KEYS[id]} checked={checked} onSelect={toggle} />
        )),
    },
    {
      id: "marks",
      width: groupWidth(DIVIDER_WIDTH, ...marks.map(() => ICON_BUTTON_WIDTH), ICON_BUTTON_WIDTH),
      active: marks.some((mark) => mark.checked),
      render: () => (
        <>
          <Divider />
          {marks.map(({ id, icon: Icon, label, checked, toggle }) => (
            <IconBtn key={id} title={label} active={checked} onClick={toggle}>
              <Icon aria-hidden className="size-4" />
            </IconBtn>
          ))}
          <LinkPicker editor={editor} />
        </>
      ),
      renderMenu: () => (
        <>
          {marks.map(({ id, icon, label, checked, toggle }) => (
            <CheckItem key={id} icon={icon} label={label} keys={KEYS[id]} checked={checked} onSelect={toggle} />
          ))}
          <LinkMenu editor={editor} onDone={() => setMoreOpen(false)} />
        </>
      ),
    },
    {
      id: "math",
      width: groupWidth(DIVIDER_WIDTH, ICON_BUTTON_WIDTH, ICON_BUTTON_WIDTH, ...(citationSource ? [DROPDOWN_TRIGGER_WIDTH] : [])),
      render: () => (
        <>
          <Divider />
          <IconBtn title={t(($) => $.editor.contextMenu.inlineMath)} onClick={() => insertMath("$x^2$")}>
            <Sigma aria-hidden className="size-4" />
          </IconBtn>
          <IconBtn title={t(($) => $.notes.toolbar.displayMath)} onClick={() => insertMath("$$x^2$$")}>
            <SquareFunction aria-hidden className="size-4" />
          </IconBtn>
          {citationSource && (
            <MenuButton editor={editor} label={t(($) => $.notes.toolbar.citation)} icon={<BookMarked aria-hidden className="size-4" />}>
              <CitationItems source={citationSource} onPick={cite} />
            </MenuButton>
          )}
        </>
      ),
      renderMenu: () => (
        <>
          <ActionItem icon={Sigma} label={t(($) => $.editor.contextMenu.inlineMath)} onSelect={() => insertMath("$x^2$")} />
          <ActionItem icon={SquareFunction} label={t(($) => $.notes.toolbar.displayMath)} onSelect={() => insertMath("$$x^2$$")} />
          {citationSource && (
            <SubMenu icon={BookMarked} label={t(($) => $.notes.toolbar.citation)}>
              <CitationItems source={citationSource} onPick={cite} />
            </SubMenu>
          )}
        </>
      ),
    },
    {
      id: "insert",
      width: groupWidth(
        DIVIDER_WIDTH,
        ICON_BUTTON_WIDTH,
        ICON_BUTTON_WIDTH,
        ICON_BUTTON_WIDTH,
        DROPDOWN_TRIGGER_WIDTH,
        ...(insertNotebook ? [ICON_BUTTON_WIDTH] : []),
      ),
      render: () => (
        <>
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
          <MenuButton editor={editor} label={t(($) => $.notes.blocks.insert.label)} icon={<Blocks aria-hidden className="size-4" />}>
            {blockGroups().map(({ id, kinds }, index) => (
              <Fragment key={id}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[0.6875rem] font-medium text-muted-foreground">
                  {t(($) => $.notes.blocks.insert[id])}
                </DropdownMenuLabel>
                {kinds.map((kind) => (
                  <DropdownMenuItem key={kind.name} data-insert-block={kind.name} onSelect={() => insertKind(kind)}>
                    <kind.icon aria-hidden className={MENU_ICON} />
                    {kind.label()}
                  </DropdownMenuItem>
                ))}
              </Fragment>
            ))}
          </MenuButton>
          {insertNotebook && (
            <IconBtn title={t(($) => $.notes.toolbar.notebook)} onClick={insertNotebook}>
              <NotebookTabs aria-hidden className="size-4" />
            </IconBtn>
          )}
        </>
      ),
      renderMenu: () => (
        <>
          <TableMenu editor={editor} />
          <ActionItem icon={ChartColumn} label={t(($) => $.notes.toolbar.chart)} onSelect={() => insertBlock("chart", newChartSource())} />
          <ActionItem
            icon={Network}
            label={t(($) => $.notes.toolbar.mermaid)}
            onSelect={() => insertBlock(NEW_BLOCKS.mermaid.info, NEW_BLOCKS.mermaid.source)}
          />
          <SubMenu icon={Blocks} label={t(($) => $.notes.blocks.insert.label)}>
            {blockGroups().map(({ id, kinds }, index) => (
              <Fragment key={id}>
                {index > 0 && <DropdownMenuSeparator />}
                {kinds.map((kind) => (
                  <ActionItem key={kind.name} icon={kind.icon} label={kind.label()} onSelect={() => insertKind(kind)} />
                ))}
              </Fragment>
            ))}
          </SubMenu>
          {insertNotebook && <ActionItem icon={NotebookTabs} label={t(($) => $.notes.toolbar.notebook)} onSelect={insertNotebook} />}
        </>
      ),
    },
    ...(state.table
      ? [
          {
            id: "table",
            width: groupWidth(DIVIDER_WIDTH, ...tableTools.map(() => ICON_BUTTON_WIDTH)),
            render: () => (
              <>
                <Divider />
                {tableTools.map(({ id, icon: Icon, label, run: apply }) => (
                  <IconBtn key={id} title={label} onClick={apply}>
                    <Icon aria-hidden className="size-4" />
                  </IconBtn>
                ))}
              </>
            ),
            renderMenu: () =>
              tableTools.map(({ id, icon, label, run: apply }) => (
                <ActionItem key={id} icon={icon} label={label} onSelect={apply} />
              )),
          },
        ]
      : []),
    {
      id: "view",
      width: GROUP_PADDING + groupWidth(DROPDOWN_TRIGGER_WIDTH, DROPDOWN_TRIGGER_WIDTH),
      render: () => (
        <span data-note-toolbar-view className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
          <MenuButton editor={editor} label={t(($) => $.notes.toolbar.width)} icon={<WidthIcon aria-hidden className="size-4" />}>
            <WidthItems width={width} />
          </MenuButton>
          <MenuButton editor={editor} label={t(($) => $.notes.toolbar.outline)} icon={<ListTree aria-hidden className="size-4" />}>
            <OutlineItems editor={editor} />
          </MenuButton>
        </span>
      ),
      renderMenu: () => (
        <>
          <WidthItems width={width} />
          <DropdownMenuSeparator />
          <SubMenu icon={ListTree} label={t(($) => $.notes.toolbar.outline)}>
            <OutlineItems editor={editor} />
          </SubMenu>
        </>
      ),
    },
    ...(showWords
      ? [
          {
            id: "words",
            width: GROUP_PADDING + Math.ceil(widestWords.length * WORD_WIDTH),
            render: () => (
              <WordCount editor={editor} className="shrink-0 whitespace-nowrap pl-2 text-[0.6875rem] tabular-nums text-muted-foreground" />
            ),
            renderMenu: () => <WordCount editor={editor} as="p" className={cn(EMPTY_ITEM, "pl-8")} />,
          },
        ]
      : []),
  ];
  const groups = readOnly ? allGroups.filter((group) => VIEW_GROUPS.has(group.id)) : allGroups;
  const { containerRef, visibleCount } = useFittedCount(groups);
  const shown = groups.slice(0, visibleCount);
  const hidden = groups.slice(visibleCount);

  return (
    <div
      role="toolbar"
      aria-label={t(($) => $.notes.toolbar.label)}
      className="sticky top-0 z-10 flex h-9 shrink-0 items-center gap-0.5 border-b bg-background px-2"
    >
      {!readOnly && (
        <>
          <IconBtn title={t(($) => $.editor.hotkeys.actions.undo)} disabled={!state.canUndo} onClick={() => run().undo().run()}>
            <Undo2 aria-hidden className="size-4" />
          </IconBtn>
          <IconBtn title={t(($) => $.editor.hotkeys.actions.redo)} disabled={!state.canRedo} onClick={() => run().redo().run()}>
            <Redo2 aria-hidden className="size-4" />
          </IconBtn>
          <Divider />
          <MenuButton
            editor={editor}
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
        </>
      )}
      <div ref={containerRef} data-note-toolbar-groups className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {shown.map((group) => (
          <Fragment key={group.id}>{group.render()}</Fragment>
        ))}
        {hidden.length > 0 && (
          <MoreMenu
            editor={editor}
            groups={hidden}
            open={moreOpen}
            onOpenChange={setMoreOpen}
            pushed={!shown.some((group) => group.id === "view")}
          />
        )}
      </div>
    </div>
  );
}

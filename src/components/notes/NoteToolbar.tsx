import type { Editor } from "@tiptap/core";
import { imageWidthPercent, mathNodeJSON } from "@oleafly/wysiwyg";
import type { ZoteroHit } from "@oleafly/backend-port";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, NodeSelection, type Selection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  Asterisk,
  AlignLeft,
  AlignRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Blocks,
  Bold,
  BookMarked,
  Braces,
  ChartColumn,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  Image as ImageIcon,
  Scaling,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  MoveHorizontal,
  Network,
  Paperclip,
  Pilcrow,
  Quote,
  RectangleHorizontal,
  RectangleVertical,
  Redo2,
  Search,
  Sigma,
  SquareCode,
  SquareFunction,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableColumnsSplit,
  TableRowsSplit,
  Trash2,
  Type,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Divider, IconBtn } from "@/components/editor/EditorToolbar";
import { TableSizePicker } from "@/components/editor/TableSizePicker";
import { Button } from "@/components/ui/button";
import { HIGHLIGHT_LANGUAGES } from "@/components/ui/code-highlighter";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  CONTROL_GAP,
  DIVIDER_WIDTH,
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  MENU_ICON,
  type ToolbarControl,
  ToolbarMenuButton,
  ToolbarMenuHost,
  ToolbarMenuItem,
  ToolbarOverflow,
  ToolbarSubMenu,
} from "@/components/ui/toolbar-overflow";
import { Tooltip } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { useFreshZoteroHits, ZoteroHitRow } from "@/components/zotero/fresh-hits";
import { insertZoteroCitation } from "@/features/zotero-actions";
import { zoteroSearchable } from "@/lib/zotero/hint";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useZoteroLibraryStore } from "@/store/zotero-library";
import { blockGroups } from "./block-views";
import { highlightOf } from "./note-highlight";
import { HighlightMenu } from "./note-highlight-menu";
import { attachFile, canAttach } from "./note-image-drop";
import { playsInNote } from "./note-path";
import { NOTE_WIDTHS, saveNoteWidth, useNoteWidth, type NoteWidth } from "./note-prefs";
import { domOutline } from "./note-outline";
import { slashItems } from "./note-slash";
import { noteWordCount } from "./note-word-count";
import { useOptionalNotesData } from "./notes-data";
import { matchingCitations } from "./note-citations";
import type { CitationItem } from "./types";

type Level = 1 | 2 | 3 | 4 | 5 | 6;
type Align = "left" | "center" | "right";

const HEADINGS: { level: Level; icon: LucideIcon }[] = [
  { level: 1, icon: Heading1 },
  { level: 2, icon: Heading2 },
  { level: 3, icon: Heading3 },
  { level: 4, icon: Heading4 },
  { level: 5, icon: Heading5 },
  { level: 6, icon: Heading6 },
];
const ALIGNS: { align: Align; icon: LucideIcon; label: "alignLeft" | "alignCenter" | "alignRight" }[] = [
  { align: "left", icon: AlignLeft, label: "alignLeft" },
  { align: "center", icon: AlignCenter, label: "alignCenter" },
  { align: "right", icon: AlignRight, label: "alignRight" },
];
const MARKS = [
  { id: "bold", icon: Bold, label: "bold" },
  { id: "italic", icon: Italic, label: "italic" },
  { id: "underline", icon: Underline, label: "underline" },
  { id: "strike", icon: Strikethrough, label: "strikethrough" },
  { id: "code", icon: Code, label: "inlineCode" },
  { id: "highlight", icon: Highlighter, label: "highlight" },
  { id: "superscript", icon: Superscript, label: "superscript" },
  { id: "subscript", icon: Subscript, label: "subscript" },
] as const;
type Mark = (typeof MARKS)[number]["id"];
const KEYS = {
  bold: "⌘B",
  italic: "⌘I",
  underline: "⌘U",
  strike: "⌘⇧S",
  code: "⌘E",
  highlight: "⌘⇧H",
  superscript: "⌘.",
  subscript: "⌘⇧,",
  bullet: "⌘⇧8",
  ordered: "⌘⇧7",
  task: "⌘⇧9",
} as const;
const EMPTY_ITEM = "px-2 py-1.5 text-xs text-muted-foreground";
const WORD_WIDTH = 6;
const GROUP_PADDING = 8;

function groupWidth(...widths: number[]): number {
  return widths.reduce((sum, width) => sum + width, 0) + CONTROL_GAP * (widths.length - 1);
}

export function returnFocus(editor: Editor): (event: Event) => void {
  return (event) => {
    event.preventDefault();
    if (editor.isDestroyed || editor.view.hasFocus()) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    editor.view.focus();
  };
}

function currentLinkHref(editor: Editor): string {
  const href: unknown = editor.getAttributes("link").href;
  return editor.isActive("link") && typeof href === "string" ? href : "";
}

function applyLink(editor: Editor, value: string): boolean {
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

function FieldForm({
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

function FieldPopover({
  icon: Icon,
  label,
  menuRow,
  children,
}: Readonly<{ icon: LucideIcon; label: string; menuRow: boolean; children: ReactNode }>) {
  const picker = (
    <Popover
      ariaLabel={label}
      closeOnClick={false}
      className="w-64 min-w-0 p-2"
      triggerClassName={menuRow ? "w-full justify-start gap-2 px-2 font-normal" : undefined}
      trigger={
        <>
          <Icon aria-hidden className="size-4" />
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

function OutlineItems({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation(["notes"]);
  const { headings, elements } = domOutline(editor.view.dom);
  if (headings.length === 0) return <p className={EMPTY_ITEM}>{t(($) => $.notes.toolbar.emptyOutline)}</p>;
  return headings.map((heading) => (
    <DropdownMenuItem
      key={heading.index}
      style={{ paddingInlineStart: `${heading.level * 0.5}rem` }}
      onSelect={() => {
        const element = elements[heading.index];
        if (!element.isConnected || editor.isDestroyed) return;
        editor.commands.setTextSelection(editor.view.posAtDOM(element, 0));
        element.scrollIntoView({ block: "start" });
      }}
    >
      {heading.text}
    </DropdownMenuItem>
  ));
}

type CitationSource = () => Promise<readonly CitationItem[]>;

interface CitationMenu {
  readonly source: CitationSource;
  readonly zotero: boolean;
}

const NO_CITATIONS: CitationSource = () => Promise.resolve([]);
const CITATION_SEARCH = "[data-citation-search]";
const ZOTERO_LIMIT = 8;

function useCitationMenu(noteId: string | undefined, projectId: string | undefined): CitationMenu | null {
  const data = useOptionalNotesData();
  const citations = data?.citations;
  const projectCitations = data?.projectCitations;
  const related = projectId ?? (noteId ? data?.notes.find((note) => note.id === noteId)?.relatedProjectId : undefined);
  const openProject = useFilesStore((state) => state.projectId);
  const searchable = useZoteroLibraryStore((state) => zoteroSearchable(state.status));
  const zotero = searchable && related !== undefined && related === openProject;
  const source = useMemo(() => {
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
  if (source) return { source, zotero };
  return zotero ? { source: NO_CITATIONS, zotero } : null;
}

function focusCitationSearch(content: HTMLElement): void {
  content.querySelector<HTMLElement>(CITATION_SEARCH)?.focus();
}

function useCitations(source: CitationSource): readonly CitationItem[] | null {
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
  return citations;
}

function CitationSearch({ value, onChange }: Readonly<{ value: string; onChange: (value: string) => void }>) {
  const { t } = useTranslation(["editor"]);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") return;
    event.stopPropagation();
    if (event.key !== "ArrowDown") return;
    const first = event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitem"]');
    if (!first) return;
    event.preventDefault();
    first.focus();
  };
  return (
    <div className="flex items-center gap-2 border-b px-2 pb-1">
      <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <Input
        data-citation-search
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t(($) => $.editor.citations.filterPlaceholder)}
        aria-label={t(($) => $.editor.citations.filterLabel)}
        className="h-7 border-0 bg-transparent px-0 text-xs shadow-none"
      />
    </div>
  );
}

function CitationItems({
  menu,
  onPick,
  onZotero,
}: Readonly<{ menu: CitationMenu; onPick: (key: string) => void; onZotero: (hit: ZoteroHit) => void }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const citations = useCitations(menu.source);
  const [query, setQuery] = useState("");
  const keys = useMemo(() => (citations ?? []).map((citation) => citation.key), [citations]);
  const { hits, pending } = useFreshZoteroHits(menu.zotero ? query : "", keys, ZOTERO_LIMIT);
  const shown = useMemo(() => matchingCitations(citations ?? [], query), [citations, query]);
  const searching = query.trim() !== "";
  return (
    <>
      {menu.zotero && <CitationSearch value={query} onChange={setQuery} />}
      {citations === null ? (
        <p className={EMPTY_ITEM}>
          <Spinner size="xs" />
        </p>
      ) : (
        shown.map((citation) => (
          <DropdownMenuItem key={citation.key} onSelect={() => onPick(citation.key)}>
            {citation.label}
          </DropdownMenuItem>
        ))
      )}
      {citations?.length === 0 && !searching && <p className={EMPTY_ITEM}>{t(($) => $.notes.toolbar.noCitations)}</p>}
      {hits.length > 0 && (
        <>
          <DropdownMenuLabel className="text-[0.6875rem] font-medium text-muted-foreground">
            {t(($) => $.editor.citations.zoteroHeading)}
          </DropdownMenuLabel>
          {hits.map((hit) => (
            <DropdownMenuItem key={`${hit.library}:${hit.itemKey}`} onSelect={() => onZotero(hit)}>
              <ZoteroHitRow hit={hit} />
            </DropdownMenuItem>
          ))}
        </>
      )}
      {searching && citations !== null && shown.length === 0 && hits.length === 0 && !pending && (
        <p className={EMPTY_ITEM}>{t(($) => $.editor.citations.noMatches)}</p>
      )}
    </>
  );
}

const VIEW_GROUPS: ReadonlySet<string> = new Set(["view", "words"]);

function shownGroups(groups: readonly ToolbarControl[], readOnly: boolean, floating: boolean): readonly ToolbarControl[] {
  if (readOnly) return groups.filter((group) => VIEW_GROUPS.has(group.id));
  return floating ? groups.filter((group) => !VIEW_GROUPS.has(group.id)) : groups;
}

const WIDTH_ICONS: Readonly<Record<NoteWidth, LucideIcon>> = {
  standard: RectangleVertical,
  wide: RectangleHorizontal,
  full: MoveHorizontal,
};

const IMAGE_SIZES = [25, 50, 75, 100] as const;
const ORIGINAL_SIZE = "original";

function ImageSizeItems({ editor, width }: Readonly<{ editor: Editor; width: number | null }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <>
      <DropdownMenuLabel inset>{t(($) => $.notes.toolbar.imageSize)}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={width === null ? ORIGINAL_SIZE : String(width)}
        onValueChange={(value) =>
          editor
            .chain()
            .focus()
            .updateAttributes("image", { widthPercent: value === ORIGINAL_SIZE ? null : Number(value) })
            .run()
        }
      >
        <DropdownMenuRadioItem value={ORIGINAL_SIZE}>{t(($) => $.notes.toolbar.originalSize)}</DropdownMenuRadioItem>
        {IMAGE_SIZES.map((size) => (
          <DropdownMenuRadioItem key={size} value={String(size)}>
            {formatNumber(size / 100, { style: "percent" })}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

function WidthItems({ width }: Readonly<{ width: NoteWidth }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <>
      <DropdownMenuLabel inset>{t(($) => $.notes.toolbar.width)}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={width} onValueChange={(value) => saveNoteWidth(value as NoteWidth)}>
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

interface ActiveEntry {
  doc: ProseMirrorNode;
  selection: Selection;
  storedMarks: EditorState["storedMarks"];
  value: ReturnType<typeof readFormatting>;
}

const activeStates = new WeakMap<Editor, ActiveEntry>();

function cellOf(selection: Selection): ProseMirrorNode | null {
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") return node;
  }
  return null;
}

function readFormatting(editor: Editor) {
  const { selection } = editor.state;
  const cell = cellOf(selection);
  const codeBlock = editor.isActive("codeBlock");
  const selected = selection instanceof NodeSelection && selection.node.type.name === "image" ? selection.node : null;
  const image = selected && !playsInNote(String(selected.attrs.src ?? "")) ? selected : null;
  return {
    ...(Object.fromEntries(MARKS.map(({ id }) => [id, editor.isActive(id)])) as Record<Mark, boolean>),
    highlightColor: editor.isActive("highlight") ? highlightOf({ attrs: editor.getAttributes("highlight") }) : null,
    bullet: editor.isActive("bulletList"),
    ordered: editor.isActive("orderedList"),
    task: editor.isActive("taskList"),
    quote: editor.isActive("blockquote"),
    codeBlock,
    language: codeBlock ? String(editor.getAttributes("codeBlock").language ?? "") : null,
    table: editor.isActive("table"),
    headerCell: cell?.type.name === "tableHeader",
    align: (cell?.attrs.align as Align | null | undefined) ?? null,
    heading: HEADINGS.find(({ level }) => editor.isActive("heading", { level }))?.level ?? null,
    imageAlt: image ? String(image.attrs.alt ?? "") : null,
    imageWidth: image ? imageWidthPercent(image.attrs.widthPercent) : null,
  };
}

function activeFormatting(editor: Editor): ReturnType<typeof readFormatting> {
  const { doc, selection, storedMarks } = editor.state;
  const cached = activeStates.get(editor);
  if (cached?.doc === doc && cached.selection === selection && cached.storedMarks === storedMarks) return cached.value;
  const value = readFormatting(editor);
  activeStates.set(editor, { doc, selection, storedMarks, value });
  return value;
}

function listIconOf({ task, ordered }: Readonly<{ task: boolean; ordered: boolean }>) {
  if (task) return ListChecks;
  return ordered ? ListOrdered : List;
}

function WordCount({ editor, className, as: Tag = "span" }: Readonly<{ editor: Editor; className: string; as?: "span" | "p" }>) {
  const { t } = useTranslation(["notes"]);
  const count = useEditorState({ editor, selector: ({ editor: current }) => noteWordCount(current) });
  return <Tag className={className}>{t(($) => $.notes.toolbar.words, { count })}</Tag>;
}

function runSlashItem(editor: Editor, id: string): void {
  const { from } = editor.state.selection;
  slashItems(editor)
    .find((item) => item.id === id)
    ?.run(editor, { from, to: from });
}

export function NoteToolbar({
  editor,
  noteId,
  projectId,
  readOnly = false,
  floating = false,
}: Readonly<{ editor: Editor; noteId?: string; projectId?: string; readOnly?: boolean; floating?: boolean }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const citationMenu = useCitationMenu(noteId, projectId);
  const width = useNoteWidth();
  const showWords = useSettingsStore((settings) => settings.notesShowWordCount);
  const [moreOpen, setMoreOpen] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      ...activeFormatting(current),
      wordDigits: showWords ? String(noteWordCount(current)).length : 0,
    }),
  });
  const attachable = canAttach(editor);
  const Heading = HEADINGS.find(({ level }) => level === state.heading)?.icon ?? Type;
  const ListIcon = listIconOf(state);
  const run = () => editor.chain().focus();
  const back = returnFocus(editor);
  const closeMore = () => setMoreOpen(false);
  const insertMath = (source: string) => {
    const node = mathNodeJSON(source);
    if (node) run().insertContent(node).run();
  };
  const cite = (key: string) => run().insertContent(`[@${key}]`).run();
  const citeFromZotero = (hit: ZoteroHit) => {
    insertZoteroCitation(hit, (key) => (cite(key) ? `[@${key}]` : null));
  };
  const widestWords = t(($) => $.notes.toolbar.words, { count: 10 ** Math.max(1, state.wordDigits) - 1 });
  const WidthIcon = WIDTH_ICONS[width];
  const item = (
    id: string,
    icon: LucideIcon,
    label: string,
    onSelect: () => unknown,
    extra: { checked?: boolean; keys?: string } = {},
  ) => ({ id, icon, label, onSelect: () => void onSelect(), ...extra });
  type Item = ReturnType<typeof item>;
  const menuItems = (items: readonly Item[], inset = false) =>
    items.map(({ id, ...rest }) => <ToolbarMenuItem key={id} inset={inset} {...rest} />);
  const barButtons = (items: readonly Item[]) =>
    items.map(({ id, icon: Icon, label, checked, onSelect }) => (
      <IconBtn key={id} title={label} active={checked} onClick={onSelect}>
        <Icon aria-hidden className="size-4" />
      </IconBtn>
    ));

  const marks = MARKS.map(({ id, icon, label }) =>
    item(id, icon, t(($) => $.editor.toolbar[label]), () => run().toggleMark(id).run(), { checked: state[id], keys: KEYS[id] }),
  );
  const textMarks = marks.slice(0, 4);
  const codeMarks = marks.slice(4, 6);
  const scriptMarks = marks.slice(6);
  const blockToggles = [
    item("quote", Quote, t(($) => $.editor.contextMenu.quote), () => run().toggleBlockquote().run(), { checked: state.quote }),
    item("codeBlock", SquareCode, t(($) => $.editor.toolbar.codeBlock), () => run().toggleCodeBlock().run(), { checked: state.codeBlock }),
  ];
  const languages = ["", ...HIGHLIGHT_LANGUAGES].map((language) =>
    item(
      `language-${language}`,
      SquareCode,
      language || t(($) => $.notes.toolbar.plainCode),
      () => run().setCodeBlock({ language }).run(),
      { checked: state.language === language },
    ),
  );
  const lists = [
    item("bullet", List, t(($) => $.notes.toolbar.bulletList), () => run().toggleBulletList().run(), { checked: state.bullet, keys: KEYS.bullet }),
    item("ordered", ListOrdered, t(($) => $.editor.toolbar.numberedList), () => run().toggleOrderedList().run(), {
      checked: state.ordered,
      keys: KEYS.ordered,
    }),
    item("task", ListChecks, t(($) => $.editor.toolbar.taskList), () => run().toggleTaskList().run(), { checked: state.task, keys: KEYS.task }),
  ];
  const math = [
    item("inlineMath", Sigma, t(($) => $.editor.contextMenu.inlineMath), () => insertMath("$x^2$")),
    item("displayMath", SquareFunction, t(($) => $.notes.toolbar.displayMath), () => insertMath("$$x^2$$")),
  ];
  const inserts = [
    item("footnote", Asterisk, t(($) => $.editor.toolbar.insertFootnote), () => run().insertFootnoteReference().run()),
    item("divider", Minus, t(($) => $.notes.blocks.slash.divider), () => runSlashItem(editor, "divider")),
    item("chart", ChartColumn, t(($) => $.notes.toolbar.chart), () => runSlashItem(editor, "block:chart")),
    item("mermaid", Network, t(($) => $.notes.toolbar.mermaid), () => runSlashItem(editor, "block:mermaid")),
  ];
  const attachments = attachable
    ? [
        item("image", ImageIcon, t(($) => $.editor.toolbar.insertImage), () => attachFile(editor, "image")),
        item("attach", Paperclip, t(($) => $.notes.toolbar.attach), () => attachFile(editor, "file")),
      ]
    : [];
  const tableTools = [
    ...(state.headerCell
      ? []
      : [item("rowAbove", BetweenHorizontalStart, t(($) => $.editor.tableToolbar.insertRowAbove), () => run().addRowBefore().run())]),
    item("rowBelow", BetweenHorizontalEnd, t(($) => $.editor.tableToolbar.insertRowBelow), () => run().addRowAfter().run()),
    item("columnLeft", BetweenVerticalStart, t(($) => $.editor.tableToolbar.insertColumnLeft), () => run().addColumnBefore().run()),
    item("columnRight", BetweenVerticalEnd, t(($) => $.editor.tableToolbar.insertColumnRight), () => run().addColumnAfter().run()),
    ...(state.headerCell
      ? []
      : [item("deleteRow", TableRowsSplit, t(($) => $.editor.tableToolbar.deleteRow), () => run().deleteRow().run())]),
    item("deleteColumn", TableColumnsSplit, t(($) => $.editor.tableToolbar.deleteColumn), () => run().deleteColumn().run()),
    ...ALIGNS.map(({ align, icon, label }) =>
      item(align, icon, t(($) => $.editor.tableToolbar[label]), () => run().setTableColumnAlign(state.align === align ? null : align).run(), {
        checked: state.align === align,
      }),
    ),
    item("deleteTable", Trash2, t(($) => $.editor.tableToolbar.deleteTable), () => run().deleteTable().run()),
  ];
  const blockMenu = () =>
    blockGroups().map(({ id, kinds }, index) => (
      <Fragment key={id}>
        {index > 0 && <DropdownMenuSeparator />}
        <DropdownMenuLabel className="text-[0.6875rem] font-medium text-muted-foreground">{t(($) => $.notes.blocks.insert[id])}</DropdownMenuLabel>
        {menuItems(kinds.map((kind) => item(kind.name, kind.icon, kind.label(), () => runSlashItem(editor, `block:${kind.name}`))))}
      </Fragment>
    ));
  const citations = citationMenu && <CitationItems menu={citationMenu} onPick={cite} onZotero={citeFromZotero} />;
  const link = (menuRow: boolean) => (
    <FieldPopover icon={Link} label={t(($) => $.notes.toolbar.link)} menuRow={menuRow}>
      <FieldForm
        label={t(($) => $.notes.toolbar.linkAddress)}
        placeholder={t(($) => $.notes.toolbar.linkPlaceholder)}
        initial={() => currentLinkHref(editor)}
        invalidText={t(($) => $.notes.toolbar.linkInvalid)}
        removeLabel={t(($) => $.editor.toolbar.removeLink)}
        onApply={(value) => applyLink(editor, value)}
        onDone={menuRow ? closeMore : undefined}
      />
    </FieldPopover>
  );
  const altText = (menuRow: boolean) => (
    <FieldPopover icon={ImageIcon} label={t(($) => $.editor.figureDialog.altLabel)} menuRow={menuRow}>
      <FieldForm
        label={t(($) => $.editor.figureDialog.altLabel)}
        placeholder={t(($) => $.editor.figureDialog.altPlaceholder)}
        initial={() => state.imageAlt ?? ""}
        allowEmpty
        onApply={(alt) => run().updateAttributes("image", { alt }).run()}
        onDone={menuRow ? closeMore : undefined}
      />
    </FieldPopover>
  );
  const table = (menuRow: boolean) => (
    <TableSizePicker
      menuRow={menuRow}
      onPick={(rows, cols) => {
        run().insertTable({ rows, cols, withHeaderRow: true }).run();
        if (menuRow) closeMore();
      }}
    />
  );

  const allGroups: ToolbarControl[] = [
    {
      id: "blocks",
      width: groupWidth(...blockToggles.map(() => ICON_BUTTON_WIDTH)),
      active: state.quote || state.codeBlock,
      render: () => barButtons(blockToggles),
      renderMenu: () => menuItems(blockToggles),
    },
    {
      id: "lists",
      width: groupWidth(DIVIDER_WIDTH, DROPDOWN_TRIGGER_WIDTH),
      active: state.bullet || state.ordered || state.task,
      render: () => (
        <>
          <Divider />
          <ToolbarMenuButton
            label={t(($) => $.notes.toolbar.list)}
            active={state.bullet || state.ordered || state.task}
            icon={<ListIcon aria-hidden className="size-4" />}
            onCloseAutoFocus={back}
          >
            {menuItems(lists)}
          </ToolbarMenuButton>
        </>
      ),
      renderMenu: () => menuItems(lists),
    },
    {
      id: "marks",
      width: groupWidth(DIVIDER_WIDTH, ...textMarks.map(() => ICON_BUTTON_WIDTH), ICON_BUTTON_WIDTH),
      active: textMarks.some((mark) => mark.checked),
      render: () => (
        <>
          <Divider />
          {barButtons(textMarks)}
          {link(false)}
        </>
      ),
      renderMenu: () => (
        <>
          {menuItems(textMarks)}
          {link(true)}
        </>
      ),
    },
    {
      id: "code",
      width: groupWidth(ICON_BUTTON_WIDTH, DROPDOWN_TRIGGER_WIDTH),
      active: codeMarks.some((mark) => mark.checked),
      render: () => (
        <>
          {barButtons(codeMarks.slice(0, 1))}
          <HighlightMenu editor={editor} color={state.highlightColor} keys={KEYS.highlight} onCloseAutoFocus={back} />
        </>
      ),
      renderMenu: () => (
        <>
          {menuItems(codeMarks.slice(0, 1))}
          <HighlightMenu editor={editor} color={state.highlightColor} keys={KEYS.highlight} inMenu />
        </>
      ),
    },
    {
      id: "scripts",
      width: groupWidth(...scriptMarks.map(() => ICON_BUTTON_WIDTH)),
      active: scriptMarks.some((mark) => mark.checked),
      render: () => barButtons(scriptMarks),
      renderMenu: () => menuItems(scriptMarks),
    },
    {
      id: "math",
      width: groupWidth(DIVIDER_WIDTH, ICON_BUTTON_WIDTH, ICON_BUTTON_WIDTH, ...(citationMenu ? [DROPDOWN_TRIGGER_WIDTH] : [])),
      render: () => (
        <>
          <Divider />
          {barButtons(math)}
          {citationMenu && (
            <ToolbarMenuButton
              label={t(($) => $.notes.toolbar.citation)}
              icon={<BookMarked aria-hidden className="size-4" />}
              onCloseAutoFocus={back}
              onContentFocus={citationMenu.zotero ? focusCitationSearch : undefined}
            >
              {citations}
            </ToolbarMenuButton>
          )}
        </>
      ),
      renderMenu: () => (
        <>
          {menuItems(math, true)}
          {citationMenu && (
            <ToolbarSubMenu
              inset
              icon={BookMarked}
              label={t(($) => $.notes.toolbar.citation)}
              onContentFocus={citationMenu.zotero ? focusCitationSearch : undefined}
            >
              {citations}
            </ToolbarSubMenu>
          )}
        </>
      ),
    },
    {
      id: "insert",
      width: groupWidth(
        DIVIDER_WIDTH,
        ...[table, ...inserts, ...attachments].map(() => ICON_BUTTON_WIDTH),
        DROPDOWN_TRIGGER_WIDTH,
      ),
      render: () => (
        <>
          <Divider />
          {table(false)}
          {barButtons(inserts)}
          <ToolbarMenuButton label={t(($) => $.notes.blocks.insert.label)} icon={<Blocks aria-hidden className="size-4" />} onCloseAutoFocus={back}>
            {blockMenu()}
          </ToolbarMenuButton>
          {barButtons(attachments)}
        </>
      ),
      renderMenu: () => (
        <>
          <ToolbarMenuHost>{table(true)}</ToolbarMenuHost>
          {menuItems(inserts, true)}
          <ToolbarSubMenu inset icon={Blocks} label={t(($) => $.notes.blocks.insert.label)}>
            {blockMenu()}
          </ToolbarSubMenu>
          {menuItems(attachments, true)}
        </>
      ),
    },
    ...(state.codeBlock
      ? [
          {
            id: "language",
            width: groupWidth(DIVIDER_WIDTH, DROPDOWN_TRIGGER_WIDTH),
            render: () => (
              <>
                <Divider />
                <ToolbarMenuButton
                  label={t(($) => $.notes.toolbar.codeLanguage)}
                  icon={<Braces aria-hidden className="size-4" />}
                  onCloseAutoFocus={back}
                >
                  {menuItems(languages)}
                </ToolbarMenuButton>
              </>
            ),
            renderMenu: () => (
              <ToolbarSubMenu inset icon={Braces} label={t(($) => $.notes.toolbar.codeLanguage)}>
                {menuItems(languages)}
              </ToolbarSubMenu>
            ),
          },
        ]
      : []),
    ...(state.table
      ? [
          {
            id: "table",
            width: groupWidth(DIVIDER_WIDTH, DROPDOWN_TRIGGER_WIDTH),
            render: () => (
              <>
                <Divider />
                <ToolbarMenuButton label={t(($) => $.editor.tableToolbar.label)} icon={<Table aria-hidden className="size-4" />} onCloseAutoFocus={back}>
                  {menuItems(tableTools, true)}
                </ToolbarMenuButton>
              </>
            ),
            renderMenu: () => menuItems(tableTools, true),
          },
        ]
      : []),
    ...(state.imageAlt === null
      ? []
      : [
          {
            id: "image",
            width: groupWidth(DIVIDER_WIDTH, ICON_BUTTON_WIDTH, DROPDOWN_TRIGGER_WIDTH),
            render: () => (
              <>
                <Divider />
                {altText(false)}
                <ToolbarMenuButton label={t(($) => $.notes.toolbar.imageSize)} icon={<Scaling aria-hidden className="size-4" />} onCloseAutoFocus={back}>
                  <ImageSizeItems editor={editor} width={state.imageWidth} />
                </ToolbarMenuButton>
              </>
            ),
            renderMenu: () => (
              <>
                {altText(true)}
                <ToolbarSubMenu icon={Scaling} label={t(($) => $.notes.toolbar.imageSize)}>
                  <ImageSizeItems editor={editor} width={state.imageWidth} />
                </ToolbarSubMenu>
              </>
            ),
          },
        ]),
    {
      id: "view",
      width: GROUP_PADDING + groupWidth(DROPDOWN_TRIGGER_WIDTH, DROPDOWN_TRIGGER_WIDTH),
      render: () => (
        <span data-note-toolbar-view className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
          <ToolbarMenuButton label={t(($) => $.notes.toolbar.width)} icon={<WidthIcon aria-hidden className="size-4" />} onCloseAutoFocus={back}>
            <WidthItems width={width} />
          </ToolbarMenuButton>
          <ToolbarMenuButton label={t(($) => $.notes.toolbar.outline)} icon={<ListTree aria-hidden className="size-4" />} onCloseAutoFocus={back}>
            <OutlineItems editor={editor} />
          </ToolbarMenuButton>
        </span>
      ),
      renderMenu: () => (
        <>
          <WidthItems width={width} />
          <DropdownMenuSeparator />
          <ToolbarSubMenu inset icon={ListTree} label={t(($) => $.notes.toolbar.outline)}>
            <OutlineItems editor={editor} />
          </ToolbarSubMenu>
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
            renderMenu: () => <WordCount editor={editor} as="p" className={`${EMPTY_ITEM} pl-8`} />,
          },
        ]
      : []),
  ];
  const groups = shownGroups(allGroups, readOnly, floating);

  return (
    <div
      role="toolbar"
      aria-label={t(($) => $.notes.toolbar.label)}
      data-note-toolbar-floating={floating || undefined}
      className={cn(
        "flex h-9 items-center gap-0.5 px-2",
        floating ? "min-w-0 rounded-full border bg-popover text-popover-foreground shadow-lg" : "sticky top-0 z-10 shrink-0 border-b bg-background",
      )}
    >
      {!readOnly && (
        <>
          {!floating && (
            <>
              <IconBtn title={t(($) => $.editor.hotkeys.actions.undo)} disabled={!state.canUndo} onClick={() => run().undo().run()}>
                <Undo2 aria-hidden className="size-4" />
              </IconBtn>
              <IconBtn title={t(($) => $.editor.hotkeys.actions.redo)} disabled={!state.canRedo} onClick={() => run().redo().run()}>
                <Redo2 aria-hidden className="size-4" />
              </IconBtn>
              <Divider />
            </>
          )}
          <ToolbarMenuButton
            label={t(($) => $.notes.toolbar.blockType)}
            active={state.heading !== null}
            icon={<Heading aria-hidden className="size-4" />}
            onCloseAutoFocus={back}
          >
            {menuItems([
              item("text", Pilcrow, t(($) => $.notes.toolbar.text), () => run().setParagraph().run()),
              ...HEADINGS.map(({ level, icon }) =>
                item(`h${level}`, icon, t(($) => $.notes.toolbar.heading, { level }), () => run().setHeading({ level }).run()),
              ),
            ])}
          </ToolbarMenuButton>
        </>
      )}
      <ToolbarOverflow
        data-note-toolbar-groups
        className="h-full"
        controls={groups}
        label={t(($) => $.notes.toolbar.more)}
        separated
        open={moreOpen}
        onOpenChange={setMoreOpen}
        onCloseAutoFocus={back}
        pushMenu={(shown) => !shown.some((group) => group.id === "view")}
      />
    </div>
  );
}

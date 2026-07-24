import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowRightToLine,
  AtSign,
  Asterisk,
  Bold,
  Braces,
  ChevronDown,
  Code,
  Divide,
  Image as ImageIcon,
  ImagePlus,
  Info,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MoreHorizontal,
  Pencil,
  Quote,
  Redo2,
  Rows3,
  Search,
  SearchCode,
  Sigma,
  Tag,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { Popover, PopoverItem } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { editorFind, editorRedo, editorUndo, getEditorView } from "./cm/controller";
import { goToDefinition, findReferences, startRename } from "@/lib/index/nav";
import { imageToLatex, imageToLatexAvailable } from "@/features/image-to-latex";
import { goToSyncTex } from "@/features/synctex";
import { countWords } from "@/lib/wordcount";
import { useCitationStore } from "@/store/citation";
import { useActiveContent, useFilesStore } from "@/store/files";
import { cn, shortcut } from "@/lib/utils";
import {
  HEADING_LEVELS,
  insertAlign,
  insertBlockquote,
  insertBold,
  insertCode,
  insertEnumerate,
  insertEquation,
  insertFigure,
  insertFootnote,
  insertFraction,
  insertHeading,
  insertItalic,
  insertItemize,
  insertLink,
  insertRef,
  insertUnderline,
} from "@/components/editor/latex-commands";
import { SymbolPicker } from "@/components/editor/SymbolPicker";
import { TableSizePicker } from "@/components/editor/TableSizePicker";

function withView(fn: (v: import("@codemirror/view").EditorView) => void) {
  const v = getEditorView();
  if (v) fn(v);
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

export function IconBtn({
  onClick,
  title,
  children,
  wide,
  "data-tour": dataTour,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  "data-tour"?: string;
}) {
  return (
    <Tooltip label={title} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        data-tour={dataTour}
        className={cn(
          "flex h-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          wide ? "w-auto px-1.5" : "w-7"
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function WysiwygModeSwitch({
  wysiwyg,
  onToggle,
  "data-tour": dataTour,
}: {
  wysiwyg: boolean;
  onToggle: () => void;
  "data-tour"?: string;
}) {
  return (
    <div
      data-tour={dataTour}
      className="flex h-7 shrink-0 items-center rounded-full bg-muted p-0.5 text-xs font-medium"
    >
      <button
        type="button"
        onClick={() => wysiwyg && onToggle()}
        aria-label="Switch to source view"
        aria-pressed={!wysiwyg}
        className={cn(
          "rounded-full px-2.5 py-1 transition-colors",
          !wysiwyg ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Code
      </button>
      <button
        type="button"
        onClick={() => !wysiwyg && onToggle()}
        aria-label="Switch to WYSIWYG view"
        aria-pressed={wysiwyg}
        className={cn(
          "rounded-full px-2.5 py-1 transition-colors",
          wysiwyg ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Visual
      </button>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

interface ToolbarControl {
  id: string;
  width: number;
  render: () => ReactNode;
  renderMenu: () => ReactNode;
}

const ICON_BUTTON_WIDTH = 28;
const DROPDOWN_TRIGGER_WIDTH = 44;

function btnControl(
  id: string,
  Icon: LucideIcon,
  label: string,
  onClick: () => void,
  tooltip?: string
): ToolbarControl {
  return {
    id,
    width: ICON_BUTTON_WIDTH,
    render: () => (
      <IconBtn onClick={onClick} title={tooltip ?? label}>
        <Icon className="size-4" />
      </IconBtn>
    ),
    renderMenu: () => <MenuRow key={id} icon={<Icon className="size-4" />} label={label} onClick={onClick} />,
  };
}

const DIVIDER_WIDTH = 9;

function dividerControl(id: string): ToolbarControl {
  return {
    id,
    width: DIVIDER_WIDTH,
    render: () => <Divider />,
    renderMenu: () => null,
  };
}

function HeadingDropdown({ variant }: { variant: "bar" | "menu" }) {
  return (
    <Popover
      ariaLabel="Heading level"
      className="w-auto min-w-0"
      triggerClassName={variant === "bar" ? "gap-0.5 px-1.5" : "w-full justify-start gap-2 px-2 font-normal"}
      trigger={
        variant === "bar" ? (
          <>
            <Type className="size-4" />
            <ChevronDown className="size-3" />
          </>
        ) : (
          <>
            <Type className="size-4" />
            <span className="flex-1 text-left">Heading</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Heading</div>
      {HEADING_LEVELS.map((level) => (
        <PopoverItem key={level.label} onClick={() => insertHeading(level)}>
          <span className="w-6 shrink-0 text-[10px] font-medium text-muted-foreground">{level.hLabel}</span>
          <span className={level.className}>{level.label}</span>
        </PopoverItem>
      ))}
    </Popover>
  );
}

function ListDropdown({ variant }: { variant: "bar" | "menu" }) {
  return (
    <Popover
      ariaLabel="Insert list"
      triggerClassName={variant === "menu" ? "w-full justify-start gap-2 px-2 font-normal" : undefined}
      trigger={
        variant === "bar" ? (
          <List className="size-4" />
        ) : (
          <>
            <List className="size-4" />
            <span className="flex-1 text-left">List</span>
          </>
        )
      }
    >
      <PopoverItem onClick={insertItemize}>
        <List className="size-4" /> Bulleted list
      </PopoverItem>
      <PopoverItem onClick={insertEnumerate}>
        <ListOrdered className="size-4" /> Numbered list
      </PopoverItem>
    </Popover>
  );
}

function CodeIntelDropdown({ variant }: { variant: "bar" | "menu" }) {
  return (
    <Popover
      ariaLabel="Code intelligence"
      triggerClassName={variant === "bar" ? "gap-0.5 px-1.5" : "w-full justify-start gap-2 px-2 font-normal"}
      trigger={
        variant === "bar" ? (
          <>
            <Braces className="size-4" />
            <ChevronDown className="size-3" />
          </>
        ) : (
          <>
            <Braces className="size-4" />
            <span className="flex-1 text-left">Code</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Code</div>
      <PopoverItem onClick={() => withView(goToDefinition)}>
        <ArrowRightToLine className="size-4" /> Go to definition
        <span className="ml-auto text-[10px] text-muted-foreground">F12</span>
      </PopoverItem>
      <PopoverItem onClick={() => withView(findReferences)}>
        <SearchCode className="size-4" /> Find references
        <span className="ml-auto text-[10px] text-muted-foreground">⇧F12</span>
      </PopoverItem>
      <PopoverItem onClick={() => withView(startRename)}>
        <Pencil className="size-4" /> Rename symbol
        <span className="ml-auto text-[10px] text-muted-foreground">F2</span>
      </PopoverItem>
    </Popover>
  );
}

function WordCountButton() {
  const content = useActiveContent();
  const activePath = useFilesStore((s) => s.activePath);
  const stats = useMemo(() => countWords(content), [content]);
  const rows: [string, number][] = [
    ["Words", stats.words],
    ["Characters", stats.characters],
    ["Lines", stats.lines],
  ];
  return (
    <Popover ariaLabel="Word count" className="w-56 p-3" trigger={<Info className="size-4" />}>
      <p className="mb-1 text-sm font-semibold text-foreground">Word count</p>
      <p className="mb-2 truncate text-xs text-muted-foreground">{activePath ?? "no file"}</p>
      <div className="divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between py-2 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono tabular-nums">{value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Popover>
  );
}

const MORE_BUTTON_WIDTH = 32;
const CONTROL_GAP = 2;

function useAvailableWidth() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const recompute = () => setAvailableWidth(container.clientWidth);
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  return { containerRef, availableWidth };
}

function fitCount(controls: ToolbarControl[], availableWidth: number): number {
  let total = 0;
  for (let i = 0; i < controls.length; i++) {
    total += controls[i].width + (i > 0 ? CONTROL_GAP : 0);
    const reserve = i < controls.length - 1 ? MORE_BUTTON_WIDTH + CONTROL_GAP : 0;
    if (total + reserve > availableWidth) return i;
  }
  return controls.length;
}

export function EditorToolbar({
  wysiwyg,
  onToggleWysiwyg,
}: {
  wysiwyg: boolean;
  onToggleWysiwyg: () => void;
}) {
  const [visionReady, setVisionReady] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectKind = useFilesStore((s) => s.projectKind);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const engine = useFilesStore((s) => s.engine);
  const syncTexSupported =
    projectKind !== "image" && projectKind !== "diagram" && engineLoaded && engine.capabilities.supports_synctex;
  useEffect(() => {
    void imageToLatexAvailable().then(setVisionReady);
  }, []);

  const controls = useMemo<ToolbarControl[]>(() => {
    const list: ToolbarControl[] = [
      {
        id: "heading",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <HeadingDropdown variant="bar" />,
        renderMenu: () => <HeadingDropdown key="heading" variant="menu" />,
      },
      dividerControl("divider-1"),
      btnControl("bold", Bold, "Bold", insertBold, `Bold (${shortcut("⌘B")})`),
      btnControl("italic", Italic, "Italic", insertItalic, `Italic (${shortcut("⌘I")})`),
      btnControl("underline", Underline, "Underline", insertUnderline),
      dividerControl("divider-2"),
      btnControl("code", Code, "Inline code", insertCode),
      btnControl("link", LinkIcon, "Insert link", insertLink),
      btnControl(
        "cite",
        AtSign,
        "Add citation",
        () => useCitationStore.getState().setOpen(true),
        "Add citation (DOI, arXiv, or title)"
      ),
      btnControl("ref", Tag, "Insert cross-reference", insertRef),
      btnControl("footnote", Asterisk, "Insert footnote", insertFootnote),
      btnControl("blockquote", Quote, "Insert blockquote", insertBlockquote),
      dividerControl("divider-3"),
      btnControl("figure", ImageIcon, "Insert figure", insertFigure),
      {
        id: "table",
        width: ICON_BUTTON_WIDTH,
        render: () => <TableSizePicker />,
        renderMenu: () => <TableSizePicker key="table" menuRow />,
      },
    ];

    if (visionReady) {
      list.push({
        id: "image-to-latex",
        width: ICON_BUTTON_WIDTH,
        render: () => (
          <IconBtn onClick={() => imageInputRef.current?.click()} title="Image to LaTeX (transcribe with AI)">
            <ImagePlus data-testid="image-to-latex" className="size-4" />
          </IconBtn>
        ),
        renderMenu: () => (
          <MenuRow
            key="image-to-latex"
            icon={<ImagePlus className="size-4" />}
            label="Image to LaTeX"
            onClick={() => imageInputRef.current?.click()}
          />
        ),
      });
    }

    list.push(
      dividerControl("divider-4"),
      {
        id: "list",
        width: ICON_BUTTON_WIDTH,
        render: () => <ListDropdown variant="bar" />,
        renderMenu: () => <ListDropdown key="list" variant="menu" />,
      },
      btnControl("align", Rows3, "Align environment", insertAlign, "Insert align environment"),
      btnControl("equation", Sigma, "Equation environment", insertEquation, "Insert equation environment"),
      btnControl("fraction", Divide, "Fraction", insertFraction, "Insert fraction"),
      dividerControl("divider-5"),
      {
        id: "symbols",
        width: ICON_BUTTON_WIDTH,
        render: () => <SymbolPicker />,
        renderMenu: () => <SymbolPicker key="symbols" menuRow />,
      },
      {
        id: "code-intel",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <CodeIntelDropdown variant="bar" />,
        renderMenu: () => <CodeIntelDropdown key="code-intel" variant="menu" />,
      }
    );

    return list;
  }, [visionReady]);

  const { containerRef, availableWidth } = useAvailableWidth();
  const visibleCount = fitCount(controls, availableWidth);
  const visibleControls = controls.slice(0, visibleCount);
  const overflowControls = controls.slice(visibleCount);

  return (
    <div className="flex h-9 items-center gap-0.5 border-b px-2">
      <IconBtn onClick={editorUndo} title={`Undo (${shortcut("⌘Z")})`}>
        <Undo2 className="size-4" />
      </IconBtn>
      <IconBtn onClick={editorRedo} title={`Redo (${shortcut("⌘⇧Z")})`}>
        <Redo2 className="size-4" />
      </IconBtn>

      <Divider />

      {visionReady && (
        <input
          ref={imageInputRef}
          data-testid="image-to-latex-input"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void imageToLatex(f);
          }}
        />
      )}

      <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {visibleControls.map((c) => (
          <Fragment key={c.id}>{c.render()}</Fragment>
        ))}
        {overflowControls.length > 0 && (
          <Popover
            ariaLabel="More formatting options"
            closeOnClick={false}
            className="max-h-96 w-56 overflow-y-auto p-1"
            trigger={<MoreHorizontal className="size-4" />}
          >
            {overflowControls.map((c) => c.renderMenu())}
          </Popover>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <WysiwygModeSwitch wysiwyg={wysiwyg} onToggle={onToggleWysiwyg} data-tour="wysiwyg-toggle" />
        <WordCountButton />
        <IconBtn onClick={editorFind} title={`Find (${shortcut("⌘F")})`}>
          <Search className="size-4" />
        </IconBtn>
        {syncTexSupported && (
          <>
            <Divider />
            <IconBtn onClick={goToSyncTex} title="Go to PDF (SyncTeX)">
              <ArrowRight className="size-4" />
            </IconBtn>
          </>
        )}
      </div>
    </div>
  );
}

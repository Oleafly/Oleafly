import { useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowRightToLine,
  Asterisk,
  Bold,
  Braces,
  ChevronDown,
  Code,
  Divide,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Package,
  Pencil,
  PenTool,
  Quote,
  Redo2,
  Rows3,
  ScanSearch,
  Search,
  SearchCode,
  SeparatorHorizontal,
  SeparatorVertical,
  Sigma,
  SlidersHorizontal,
  Tag,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MarkdownSplitLayout } from "@/lib/wysiwyg-mode";
import { Tooltip } from "@/components/ui/tooltip";
import { editorFind, editorRedo, editorUndo, getEditorView } from "./cm/controller";
import { useEditorHistory } from "./history-signal";
import { goToDefinition, findReferences, startRename } from "@/lib/index/nav";
import { imageToLatex } from "@/features/image-to-latex";
import { useToolsImageReady } from "@/hooks/use-tools-image-ready";
import { goToSyncTex } from "@/features/synctex";
import { engineSyncsPath } from "@/lib/document-engine";
import { openDiagramComposer } from "@/features/open-tool";
import { ProjectInfoButton } from "@/components/editor/ProjectInfo";
import { useFilesStore } from "@/store/files";
import { useActiveFileReadOnly } from "@/lib/read-only-files";
import { runCiteOleaflyAction } from "@/features/cite-oleafly";
import { openLatexPackages } from "@/components/packages/open";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";
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
import { ProjectCitationPicker } from "@/components/editor/ProjectCitationPicker";
import {
  DIVIDER_WIDTH,
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  type ToolbarControl,
  ToolbarDropdown,
  type ToolbarDropdownItem,
  ToolbarMenuItem,
  ToolbarOverflow,
  toolbarPicker,
} from "@/components/ui/toolbar-overflow";

function withProjectSymbol(
  sourceAction: (view: import("@codemirror/view").EditorView) => void,
) {
  const v = getEditorView();
  if (v) sourceAction(v);
}

export function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

export function IconBtn({
  onClick,
  title,
  children,
  wide,
  active,
  disabled,
  "data-tour": dataTour,
}: Readonly<{
  onClick: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  active?: boolean;
  disabled?: boolean;
  "data-tour"?: string;
}>) {
  return (
    <Tooltip label={title} side="bottom">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        aria-label={title}
        aria-pressed={active}
        disabled={disabled}
        data-tour={dataTour}
        className={cn(
          "flex h-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
          wide ? "w-auto px-1.5" : "w-7",
          active && "bg-primary/10 text-foreground",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export type EditorMode = "code" | "visual" | "both";

export function WysiwygModeSwitch({
  wysiwyg,
  onToggle,
  secondLabel,
  mode = wysiwyg ? "visual" : "code",
  splitLayout = "split",
  onModeChange,
  "data-tour": dataTour,
}: Readonly<{
  wysiwyg: boolean;
  onToggle: () => void;
  secondLabel?: string;
  mode?: EditorMode;
  splitLayout?: MarkdownSplitLayout;
  onModeChange?: (mode: EditorMode, layout?: MarkdownSplitLayout) => void;
  "data-tour"?: string;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const selectMode = (next: EditorMode) => {
    if (next === mode) return;
    if (onModeChange) onModeChange(next);
    else onToggle();
  };
  return (
    <div
      data-tour={dataTour}
      className="flex h-7 shrink-0 items-center rounded-full bg-muted p-0.5 text-xs font-medium"
    >
      <button
        type="button"
        onClick={() => selectMode("code")}
        aria-label={t(($) => $.editor.toolbar.switchToSource)}
        aria-pressed={mode === "code"}
        className={cn(
          "rounded-full px-2.5 py-1 transition-colors",
          mode === "code" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {t(($) => $.editor.toolbar.code)}
      </button>
      <button
        type="button"
        onClick={() => selectMode("visual")}
        aria-label={t(($) => $.editor.toolbar.switchToVisual)}
        aria-pressed={mode === "visual"}
        className={cn(
          "rounded-full px-2.5 py-1 transition-colors",
          mode === "visual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {secondLabel ?? t(($) => $.editor.toolbar.visual)}
      </button>
      {onModeChange && <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-pressed={mode === "both"}
            className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors",
              mode === "both" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t(($) => $.editor.toolbar.both)}
            <ChevronDown aria-hidden className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={mode === "both" ? splitLayout : ""}>
            <DropdownMenuRadioItem value="stacked" className="gap-2" onSelect={() => onModeChange("both", "stacked")}>
              <SeparatorHorizontal aria-hidden className="size-4" />
              {t(($) => $.editor.toolbar.stacked)}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="split" className="gap-2" onSelect={() => onModeChange("both", "split")}>
              <SeparatorVertical aria-hidden className="size-4" />
              {t(($) => $.editor.toolbar.split)}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
  );
}


export function btnControl(
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
    renderMenu: () => <ToolbarMenuItem key={id} icon={Icon} label={label} onSelect={onClick} />,
  };
}

export function dividerControl(id: string): ToolbarControl {
  return {
    id,
    width: DIVIDER_WIDTH,
    render: () => <Divider />,
    renderMenu: () => null,
  };
}

export function headingItems<L extends { hLabel: string; className: string; label: () => string }>(
  levels: readonly L[],
  insert: (level: L) => void,
): ToolbarDropdownItem[] {
  return levels.map((level) => ({
    key: level.hLabel,
    onSelect: () => insert(level),
    content: (
      <>
        <span className="w-6 shrink-0 text-[0.625rem] font-medium text-muted-foreground">{level.hLabel}</span>
        <span className={level.className}>{level.label()}</span>
      </>
    ),
  }));
}

export function HeadingDropdown<L extends { hLabel: string; className: string; label: () => string }>({
  variant,
  levels,
  insert,
}: Readonly<{ variant: "bar" | "menu"; levels: readonly L[]; insert: (level: L) => void }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <ToolbarDropdown
      variant={variant}
      icon={Type}
      label={t(($) => $.editor.toolbar.heading)}
      ariaLabel={t(($) => $.editor.toolbar.headingLevel)}
      heading={t(($) => $.editor.toolbar.heading)}
      className="w-fit min-w-0 max-w-56"
      items={headingItems(levels, insert)}
    />
  );
}

function ListDropdown({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <ToolbarDropdown
      variant={variant}
      icon={List}
      chevron={false}
      label={t(($) => $.editor.toolbar.list)}
      ariaLabel={t(($) => $.editor.toolbar.insertList)}
      items={[
        { key: "bullet", onSelect: insertItemize, content: <><List className="size-4" /> {t(($) => $.editor.toolbar.bulletedList)}</> },
        { key: "number", onSelect: insertEnumerate, content: <><ListOrdered className="size-4" /> {t(($) => $.editor.toolbar.numberedList)}</> },
      ]}
    />
  );
}

const CODE_ACTIONS = [
  { key: "definition", icon: ArrowRightToLine, action: goToDefinition, keys: "F12", label: "goToDefinition" },
  { key: "references", icon: SearchCode, action: findReferences, keys: "⇧F12", label: "findReferences" },
  { key: "rename", icon: Pencil, action: startRename, keys: "F2", label: "renameSymbol" },
] as const;

export function CodeIntelDropdown({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <ToolbarDropdown
      variant={variant}
      icon={Braces}
      label={t(($) => $.editor.toolbar.code)}
      ariaLabel={t(($) => $.editor.toolbar.codeIntelligence)}
      heading={t(($) => $.editor.toolbar.code)}
      items={CODE_ACTIONS.map(({ key, icon: Icon, action, keys, label }) => ({
        key,
        onSelect: () => withProjectSymbol(action),
        content: (
          <>
            <Icon className="size-4" /> {t(($) => $.editor.toolbar[label])}
            <span className="ml-auto text-[0.625rem] text-muted-foreground">{shortcut(keys)}</span>
          </>
        ),
      }))}
    />
  );
}


export function EditorToolbar({
  wysiwyg,
  onToggleWysiwyg,
}: Readonly<{
  wysiwyg: boolean;
  onToggleWysiwyg: () => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const visionReady = useToolsImageReady();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectKind = useFilesStore((s) => s.projectKind);
  const activePath = useFilesStore((s) => s.activePath);
  const activeReadOnly = useActiveFileReadOnly();
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const engine = useFilesStore((s) => s.engine);
  const syncTexSupported =
    projectKind !== "image" && projectKind !== "diagram" && engineLoaded && engineSyncsPath(engine, activePath);
  const latexProject = engineLoaded && engine.source_format === "latex";
  const latexDocument = latexProject && projectKind !== "diagram" && projectKind !== "image";

  const controls = useMemo<ToolbarControl[]>(() => {
    const list: ToolbarControl[] = [
      {
        id: "heading",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <HeadingDropdown variant="bar" levels={HEADING_LEVELS} insert={insertHeading} />,
        renderMenu: () => <HeadingDropdown key="heading" variant="menu" levels={HEADING_LEVELS} insert={insertHeading} />,
      },
      dividerControl("divider-1"),
      btnControl(
        "bold",
        Bold,
        t(($) => $.editor.toolbar.bold),
        insertBold,
        t(($) => $.editor.toolbar.boldWithShortcut, { shortcut: shortcut("⌘B") }),
      ),
      btnControl(
        "italic",
        Italic,
        t(($) => $.editor.toolbar.italic),
        insertItalic,
        t(($) => $.editor.toolbar.italicWithShortcut, { shortcut: shortcut("⌘I") }),
      ),
      btnControl("underline", Underline, t(($) => $.editor.toolbar.underline), insertUnderline),
      dividerControl("divider-2"),
      btnControl("code", Code, t(($) => $.editor.toolbar.inlineCode), insertCode),
      btnControl("link", LinkIcon, t(($) => $.editor.toolbar.insertLink), insertLink),
      toolbarPicker("cite", ICON_BUTTON_WIDTH, (menu) => <ProjectCitationPicker variant={menu ? "menu" : "bar"} />),
      btnControl("ref", Tag, t(($) => $.editor.toolbar.insertCrossReference), insertRef),
      btnControl("footnote", Asterisk, t(($) => $.editor.toolbar.insertFootnote), insertFootnote),
      btnControl("blockquote", Quote, t(($) => $.editor.toolbar.insertBlockquote), insertBlockquote),
      dividerControl("divider-3"),
      btnControl("figure", ImageIcon, t(($) => $.editor.toolbar.insertFigure), insertFigure),
      toolbarPicker("table", ICON_BUTTON_WIDTH, (menuRow) => <TableSizePicker menuRow={menuRow} />),
      btnControl("diagram", PenTool, t(($) => $.editor.toolbar.drawDiagram), () => void openDiagramComposer("tikz")),
    ];

    if (visionReady) {
      list.push({
        id: "image-to-latex",
        width: ICON_BUTTON_WIDTH,
        render: () => (
          <IconBtn
            onClick={() => imageInputRef.current?.click()}
            title={t(($) => $.editor.toolbar.imageToLatexTooltip)}
          >
            <ImagePlus data-testid="image-to-latex" className="size-4" />
          </IconBtn>
        ),
        renderMenu: () => (
          <ToolbarMenuItem
            key="image-to-latex"
            icon={ImagePlus}
            label={t(($) => $.editor.toolbar.imageToLatex)}
            onSelect={() => imageInputRef.current?.click()}
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
      btnControl(
        "align",
        Rows3,
        t(($) => $.editor.toolbar.alignEnvironment),
        insertAlign,
        t(($) => $.editor.toolbar.insertAlignEnvironment),
      ),
      btnControl(
        "equation",
        Sigma,
        t(($) => $.editor.toolbar.equationEnvironment),
        insertEquation,
        t(($) => $.editor.toolbar.insertEquationEnvironment),
      ),
      btnControl(
        "fraction",
        Divide,
        t(($) => $.editor.toolbar.fraction),
        insertFraction,
        t(($) => $.editor.toolbar.insertFraction),
      ),
      dividerControl("divider-5"),
      toolbarPicker("symbols", ICON_BUTTON_WIDTH, (menuRow) => <SymbolPicker menuRow={menuRow} />),
      {
        id: "code-intel",
        width: DROPDOWN_TRIGGER_WIDTH,
        render: () => <CodeIntelDropdown variant="bar" />,
        renderMenu: () => <CodeIntelDropdown key="code-intel" variant="menu" />,
      },
    );

    return list;
  }, [t, visionReady]);

  const history = useEditorHistory();

  return (
    <div data-testid="editor-toolbar" className="flex h-9 items-center gap-0.5 border-b px-2">
      <WysiwygModeSwitch
        wysiwyg={wysiwyg}
        onToggle={onToggleWysiwyg}
        secondLabel={
          projectKind === "diagram"
            ? t(($) => $.editor.toolbar.canvas)
            : t(($) => $.editor.toolbar.visual)
        }
        data-tour="wysiwyg-toggle"
      />
      <Divider />

      <IconBtn onClick={editorUndo} disabled={!history.canUndo} title={t(($) => $.editor.toolbar.undo, { shortcut: shortcut("⌘Z") })}>
        <Undo2 className="size-4" />
      </IconBtn>
      <IconBtn onClick={editorRedo} disabled={!history.canRedo} title={t(($) => $.editor.toolbar.redo, { shortcut: shortcut("⌘⇧Z") })}>
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

      <ToolbarOverflow controls={controls} label={t(($) => $.editor.toolbar.moreOptions)} />

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {activePath?.toLowerCase().endsWith(".bib") && !activeReadOnly && (
          <IconBtn
            onClick={() => void runCiteOleaflyAction({ path: activePath })}
            title={t(($) => $.editor.toolbar.citeOleafly)}
          >
            <Quote className="size-4" />
          </IconBtn>
        )}
        {latexProject && (
          <IconBtn onClick={openLatexPackages} title={t(($) => $.editor.toolbar.latexPackages)}>
            <Package className="size-4" />
          </IconBtn>
        )}
        {latexDocument && (
          <IconBtn
            onClick={() => useTypstDocumentPanelStore.getState().openPanel("insights")}
            title={t(($) => $.editor.typstInsights.title)}
          >
            <ScanSearch data-testid="document-insights-button" className="size-4" />
          </IconBtn>
        )}
        {latexDocument && (
          <IconBtn
            onClick={() => useTypstDocumentPanelStore.getState().openPanel("settings")}
            title={t(($) => $.editor.typstSettings.title)}
          >
            <SlidersHorizontal data-testid="document-settings-button" className="size-4" />
          </IconBtn>
        )}
        <ProjectInfoButton surface="source" />
        <IconBtn onClick={editorFind} title={t(($) => $.editor.toolbar.find, { shortcut: shortcut("⌘F") })}>
          <Search className="size-4" />
        </IconBtn>
        {syncTexSupported && (
          <>
            <Divider />
            <IconBtn onClick={goToSyncTex} title={t(($) => $.editor.toolbar.goToPdf)}>
              <ArrowRight className="size-4" />
            </IconBtn>
          </>
        )}
      </div>
    </div>
  );
}

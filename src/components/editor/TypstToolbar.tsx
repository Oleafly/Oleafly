import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ArrowRightToLine,
  Asterisk,
  Bold,
  BookmarkPlus,
  Braces,
  ChevronDown,
  Code,
  Divide,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  Images,
  Italic,
  Link as LinkIcon,
  List,
  MoreHorizontal,
  Package,
  Pencil,
  PenTool,
  Quote,
  Redo2,
  Rows3,
  ScanSearch,
  Search,
  SearchCode,
  Sigma,
  SlidersHorizontal,
  SquareCode,
  SquareSigma,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { MenuRow } from "@/components/ui/menu-row";
import { Popover, PopoverItem } from "@/components/ui/popover";
import {
  Divider,
  IconBtn,
  WysiwygModeSwitch,
  btnControl,
  dividerControl,
} from "@/components/editor/EditorToolbar";
import { ProjectInfoButton } from "@/components/editor/ProjectInfo";
import { ProjectCitationPicker } from "@/components/editor/ProjectCitationPicker";
import { SymbolPicker } from "@/components/editor/SymbolPicker";
import { TableSizePicker } from "@/components/editor/TableSizePicker";
import { TypstLabelPicker } from "@/components/editor/TypstLabelPicker";
import {
  DROPDOWN_TRIGGER_WIDTH,
  ICON_BUTTON_WIDTH,
  fitCount,
  useAvailableWidth,
  type ToolbarControl,
} from "@/components/ui/toolbar-overflow";
import { editorFind, editorRedo, editorUndo, getEditorView } from "@/components/editor/cm/controller";
import {
  TYPST_HEADING_LEVELS,
  addTypstLabel,
  insertTypstAlignedMath,
  insertTypstBold,
  insertTypstBulletList,
  insertTypstCodeBlock,
  insertTypstDisplayMath,
  insertTypstFigure,
  insertTypstFootnote,
  insertTypstFraction,
  insertTypstHeading,
  insertTypstImage,
  insertTypstItalic,
  insertTypstLink,
  insertTypstMath,
  insertTypstNumberedEquation,
  insertTypstNumberedList,
  insertTypstQuote,
  insertTypstRawInline,
  insertTypstStrikethrough,
  insertTypstTable,
  insertTypstUnderline,
} from "@/components/editor/typst-commands";
import { imageToLatexAvailable, imageToTypst } from "@/features/image-to-latex";
import { findReferences, goToDefinition, startRename } from "@/lib/index/nav";
import { shortcut } from "@/lib/utils";
import { openTypstPackages } from "@/components/typst-packages/open";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";
import { goToSyncTex } from "@/features/synctex";
import { openDiagramComposer } from "@/features/open-tool";
import { useFilesStore } from "@/store/files";

function withView(action: (view: EditorView) => void) {
  const view = getEditorView();
  if (view) action(view);
}

function TypstHeadingDropdown({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <Popover
      ariaLabel={t(($) => $.editor.toolbar.headingLevel)}
      className="w-fit min-w-0 max-w-56"
      triggerClassName={
        variant === "bar" ? "gap-0.5 px-1.5" : "w-full justify-start gap-2 px-2 font-normal"
      }
      trigger={
        variant === "bar" ? (
          <>
            <Type className="size-4" />
            <ChevronDown className="size-3" />
          </>
        ) : (
          <>
            <Type className="size-4" />
            <span className="flex-1 text-left">{t(($) => $.editor.toolbar.heading)}</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t(($) => $.editor.toolbar.heading)}
      </div>
      {TYPST_HEADING_LEVELS.map((level) => (
        <PopoverItem key={level.hLabel} onClick={() => insertTypstHeading(level)}>
          <span className="w-6 shrink-0 text-[10px] font-medium text-muted-foreground">{level.hLabel}</span>
          <span className={level.className}>{level.label()}</span>
        </PopoverItem>
      ))}
    </Popover>
  );
}

function TypstListDropdown({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <Popover
      ariaLabel={t(($) => $.editor.toolbar.listType)}
      className="w-fit min-w-0 max-w-56"
      triggerClassName={
        variant === "bar" ? "gap-0.5 px-1.5" : "w-full justify-start gap-2 px-2 font-normal"
      }
      trigger={
        variant === "bar" ? (
          <>
            <List className="size-4" />
            <ChevronDown className="size-3" />
          </>
        ) : (
          <>
            <List className="size-4" />
            <span className="flex-1 text-left">{t(($) => $.editor.toolbar.list)}</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <PopoverItem onClick={insertTypstBulletList}>{t(($) => $.editor.toolbar.bulletedList)}</PopoverItem>
      <PopoverItem onClick={insertTypstNumberedList}>{t(($) => $.editor.toolbar.numberedList)}</PopoverItem>
    </Popover>
  );
}

function TypstCodeIntelDropdown({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <Popover
      ariaLabel={t(($) => $.editor.toolbar.codeIntelligence)}
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
            <span className="flex-1 text-left">{t(($) => $.editor.toolbar.code)}</span>
            <ChevronDown className="size-3" />
          </>
        )
      }
    >
      <PopoverItem onClick={() => withView(goToDefinition)}>
        <ArrowRightToLine className="size-4" /> {t(($) => $.editor.toolbar.goToDefinition)}
        <span className="ml-auto text-[10px] text-muted-foreground">{shortcut("F12")}</span>
      </PopoverItem>
      <PopoverItem onClick={() => withView(findReferences)}>
        <SearchCode className="size-4" /> {t(($) => $.editor.toolbar.findReferences)}
        <span className="ml-auto text-[10px] text-muted-foreground">{shortcut("⇧F12")}</span>
      </PopoverItem>
      <PopoverItem onClick={() => withView(startRename)}>
        <Pencil className="size-4" /> {t(($) => $.editor.toolbar.renameSymbol)}
        <span className="ml-auto text-[10px] text-muted-foreground">{shortcut("F2")}</span>
      </PopoverItem>
    </Popover>
  );
}

function dropdownControl(
  id: string,
  render: (variant: "bar" | "menu") => ReactNode,
  width = DROPDOWN_TRIGGER_WIDTH,
): ToolbarControl {
  return {
    id,
    width,
    render: () => render("bar"),
    renderMenu: () => <Fragment key={id}>{render("menu")}</Fragment>,
  };
}

/**
 * Formatting bar for Typst documents. Typst has no visual editing surface, so
 * this is source-only: every control writes Typst markup at the cursor.
 */
export function TypstToolbar({
  wysiwyg,
  onToggleWysiwyg,
}: Readonly<{ wysiwyg?: boolean; onToggleWysiwyg?: () => void }> = {}) {
  const { t } = useTranslation(["common", "editor"]);
  const pdfSyncSupported = useFilesStore(
    (s) =>
      s.projectKind !== "image" &&
      s.projectKind !== "diagram" &&
      s.engineLoaded &&
      s.engine.id === "typst" &&
      s.engine.capabilities.supports_synctex,
  );
  const [visionReady, setVisionReady] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void imageToLatexAvailable().then((ready) => {
      if (active) setVisionReady(ready);
    });
    return () => {
      active = false;
    };
  }, []);

  const controls = useMemo<ToolbarControl[]>(() => {
    const list: ToolbarControl[] = [
      dropdownControl("heading", (variant) => <TypstHeadingDropdown variant={variant} />),
      dividerControl("divider-1"),
      btnControl(
        "bold",
        Bold,
        t(($) => $.editor.toolbar.bold),
        insertTypstBold,
        t(($) => $.editor.toolbar.boldWithShortcut, { shortcut: shortcut("⌘B") }),
      ),
      btnControl(
        "italic",
        Italic,
        t(($) => $.editor.toolbar.italic),
        insertTypstItalic,
        t(($) => $.editor.toolbar.italicWithShortcut, { shortcut: shortcut("⌘I") }),
      ),
      btnControl("underline", Underline, t(($) => $.editor.toolbar.underline), insertTypstUnderline),
      btnControl(
        "strikethrough",
        Strikethrough,
        t(($) => $.editor.toolbar.strikethrough),
        insertTypstStrikethrough,
      ),
      dividerControl("divider-2"),
      btnControl("code", Code, t(($) => $.editor.toolbar.inlineCode), insertTypstRawInline),
      btnControl("link", LinkIcon, t(($) => $.editor.toolbar.insertLink), insertTypstLink),
      dropdownControl("cite", (variant) => <ProjectCitationPicker variant={variant} />, ICON_BUTTON_WIDTH),
      dropdownControl("reference", (variant) => <TypstLabelPicker variant={variant} />, ICON_BUTTON_WIDTH),
      btnControl("add-label", BookmarkPlus, t(($) => $.editor.toolbar.addLabel), () => void addTypstLabel()),
      btnControl("footnote", Asterisk, t(($) => $.editor.toolbar.insertFootnote), insertTypstFootnote),
      btnControl("quote", Quote, t(($) => $.editor.toolbar.insertBlockquote), insertTypstQuote),
      dividerControl("divider-3"),
      btnControl("figure", ImageIcon, t(($) => $.editor.toolbar.insertFigure), () => void insertTypstFigure()),
      {
        id: "table",
        width: ICON_BUTTON_WIDTH,
        render: () => <TableSizePicker onPick={(rows, cols) => void insertTypstTable(rows, cols)} />,
        renderMenu: () => (
          <TableSizePicker key="table" menuRow onPick={(rows, cols) => void insertTypstTable(rows, cols)} />
        ),
      },
      btnControl("image", Images, t(($) => $.editor.toolbar.insertImage), insertTypstImage),
      btnControl("diagram", PenTool, t(($) => $.editor.toolbar.drawDiagram), () => void openDiagramComposer("typst")),
    ];

    if (visionReady) {
      list.push({
        id: "image-to-typst",
        width: ICON_BUTTON_WIDTH,
        render: () => (
          <IconBtn
            onClick={() => imageInputRef.current?.click()}
            title={t(($) => $.editor.toolbar.imageToTypstTooltip)}
          >
            <ImagePlus data-testid="image-to-typst" className="size-4" />
          </IconBtn>
        ),
        renderMenu: () => (
          <MenuRow
            key="image-to-typst"
            icon={<ImagePlus className="size-4" />}
            label={t(($) => $.editor.toolbar.imageToTypst)}
            onClick={() => imageInputRef.current?.click()}
          />
        ),
      });
    }

    list.push(
      dividerControl("divider-4"),
      dropdownControl("list", (variant) => <TypstListDropdown variant={variant} />),
      btnControl("math", Sigma, t(($) => $.editor.toolbar.math), insertTypstMath),
      btnControl("display-math", SquareSigma, t(($) => $.editor.toolbar.displayMath), insertTypstDisplayMath),
      btnControl(
        "numbered-equation",
        Hash,
        t(($) => $.editor.toolbar.numberedEquation),
        () => void insertTypstNumberedEquation(),
      ),
      btnControl("aligned-equations", Rows3, t(($) => $.editor.toolbar.alignedEquations), insertTypstAlignedMath),
      btnControl(
        "fraction",
        Divide,
        t(($) => $.editor.toolbar.fraction),
        insertTypstFraction,
        t(($) => $.editor.toolbar.insertFraction),
      ),
      dividerControl("divider-5"),
      {
        id: "symbols",
        width: ICON_BUTTON_WIDTH,
        render: () => <SymbolPicker language="typst" />,
        renderMenu: () => <SymbolPicker key="symbols" menuRow language="typst" />,
      },
      btnControl("code-block", SquareCode, t(($) => $.editor.toolbar.codeBlock), insertTypstCodeBlock),
      dropdownControl("code-intel", (variant) => <TypstCodeIntelDropdown variant={variant} />),
    );
    return list;
  }, [t, visionReady]);

  const { containerRef, availableWidth } = useAvailableWidth();
  const visibleCount = fitCount(controls, availableWidth);
  const visibleControls = controls.slice(0, visibleCount);
  const overflowControls = controls.slice(visibleCount);

  return (
    <div data-testid="typst-toolbar" className="flex h-9 items-center gap-0.5 border-b px-2">
      {onToggleWysiwyg ? (
        <>
          <WysiwygModeSwitch
            wysiwyg={wysiwyg ?? false}
            onToggle={onToggleWysiwyg}
            secondLabel={t(($) => $.editor.toolbar.visual)}
            data-tour="wysiwyg-toggle"
          />
          <Divider />
        </>
      ) : null}
      <IconBtn onClick={editorUndo} title={t(($) => $.editor.toolbar.undo, { shortcut: shortcut("⌘Z") })}>
        <Undo2 className="size-4" />
      </IconBtn>
      <IconBtn onClick={editorRedo} title={t(($) => $.editor.toolbar.redo, { shortcut: shortcut("⌘⇧Z") })}>
        <Redo2 className="size-4" />
      </IconBtn>

      <Divider />

      {visionReady && (
        <input
          ref={imageInputRef}
          data-testid="image-to-typst-input"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void imageToTypst(file);
          }}
        />
      )}

      <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {visibleControls.map((control) => (
          <Fragment key={control.id}>{control.render()}</Fragment>
        ))}
        {overflowControls.length > 0 && (
          <Popover
            ariaLabel={t(($) => $.editor.toolbar.moreOptions)}
            closeOnClick={false}
            className="max-h-96 w-56 overflow-y-auto p-1"
            trigger={<MoreHorizontal className="size-4" />}
          >
            {overflowControls.map((control) => control.renderMenu())}
          </Popover>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconBtn onClick={openTypstPackages} title={t(($) => $.editor.toolbar.typstPackages)}>
          <Package className="size-4" />
        </IconBtn>
        <IconBtn
          onClick={() => useTypstDocumentPanelStore.getState().openPanel("insights")}
          title={t(($) => $.editor.typstInsights.title)}
        >
          <ScanSearch data-testid="typst-insights-button" className="size-4" />
        </IconBtn>
        <IconBtn
          onClick={() => useTypstDocumentPanelStore.getState().openPanel("settings")}
          title={t(($) => $.editor.typstSettings.title)}
        >
          <SlidersHorizontal data-testid="typst-settings-button" className="size-4" />
        </IconBtn>
        <ProjectInfoButton surface="source" />
        <IconBtn onClick={editorFind} title={t(($) => $.editor.toolbar.find, { shortcut: shortcut("⌘F") })}>
          <Search className="size-4" />
        </IconBtn>
        {pdfSyncSupported && (
          <>
            <Divider />
            <IconBtn onClick={goToSyncTex} title={t(($) => $.editor.toolbar.goToPdfTypst)}>
              <ArrowRight className="size-4" />
            </IconBtn>
          </>
        )}
      </div>
    </div>
  );
}

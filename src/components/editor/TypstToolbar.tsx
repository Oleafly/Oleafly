import { Fragment, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Asterisk,
  Bold,
  BookmarkPlus,
  Code,
  Divide,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  Images,
  Italic,
  Link as LinkIcon,
  List,
  Package,
  PenTool,
  Quote,
  Redo2,
  Rows3,
  ScanSearch,
  Search,
  Sigma,
  SlidersHorizontal,
  SquareCode,
  SquareSigma,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import {
  CodeIntelDropdown,
  Divider,
  HeadingDropdown,
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
  type ToolbarControl,
  ToolbarDropdown,
  ToolbarMenuItem,
  ToolbarOverflow,
  toolbarPicker,
} from "@/components/ui/toolbar-overflow";
import { editorFind, editorRedo, editorUndo } from "@/components/editor/cm/controller";
import { useEditorHistory } from "@/components/editor/history-signal";
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
import { imageToTypst } from "@/features/image-to-latex";
import { useToolsImageReady } from "@/hooks/use-tools-image-ready";
import { shortcut } from "@/lib/utils";
import { openTypstPackages } from "@/components/typst-packages/open";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";
import { goToSyncTex } from "@/features/synctex";
import { openDiagramComposer } from "@/features/open-tool";
import { useFilesStore } from "@/store/files";

function TypstListDropdown({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <ToolbarDropdown
      variant={variant}
      icon={List}
      label={t(($) => $.editor.toolbar.list)}
      ariaLabel={t(($) => $.editor.toolbar.listType)}
      className="w-fit min-w-0 max-w-56"
      items={[
        { key: "bullet", onSelect: insertTypstBulletList, content: t(($) => $.editor.toolbar.bulletedList) },
        { key: "numbered", onSelect: insertTypstNumberedList, content: t(($) => $.editor.toolbar.numberedList) },
      ]}
    />
  );
}

function dropdownControl(id: string, render: (variant: "bar" | "menu") => ReactNode): ToolbarControl {
  return { id, width: DROPDOWN_TRIGGER_WIDTH, render: () => render("bar"), renderMenu: () => <Fragment key={id}>{render("menu")}</Fragment> };
}

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
  const visionReady = useToolsImageReady();
  const imageInputRef = useRef<HTMLInputElement>(null);

  const controls = useMemo<ToolbarControl[]>(() => {
    const list: ToolbarControl[] = [
      dropdownControl("heading", (variant) => (
        <HeadingDropdown variant={variant} levels={TYPST_HEADING_LEVELS} insert={insertTypstHeading} />
      )),
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
      toolbarPicker("cite", ICON_BUTTON_WIDTH, (menu) => <ProjectCitationPicker variant={menu ? "menu" : "bar"} />),
      toolbarPicker("reference", ICON_BUTTON_WIDTH, (menu) => <TypstLabelPicker variant={menu ? "menu" : "bar"} />),
      btnControl("add-label", BookmarkPlus, t(($) => $.editor.toolbar.addLabel), () => void addTypstLabel()),
      btnControl("footnote", Asterisk, t(($) => $.editor.toolbar.insertFootnote), insertTypstFootnote),
      btnControl("quote", Quote, t(($) => $.editor.toolbar.insertBlockquote), insertTypstQuote),
      dividerControl("divider-3"),
      btnControl("figure", ImageIcon, t(($) => $.editor.toolbar.insertFigure), () => void insertTypstFigure()),
      toolbarPicker("table", ICON_BUTTON_WIDTH, (menuRow) => (
        <TableSizePicker menuRow={menuRow} onPick={(rows, cols) => void insertTypstTable(rows, cols)} />
      )),
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
          <ToolbarMenuItem
            key="image-to-typst"
            icon={ImagePlus}
            label={t(($) => $.editor.toolbar.imageToTypst)}
            onSelect={() => imageInputRef.current?.click()}
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
      toolbarPicker("symbols", ICON_BUTTON_WIDTH, (menuRow) => <SymbolPicker menuRow={menuRow} language="typst" />),
      btnControl("code-block", SquareCode, t(($) => $.editor.toolbar.codeBlock), insertTypstCodeBlock),
      dropdownControl("code-intel", (variant) => <CodeIntelDropdown variant={variant} />),
    );
    return list;
  }, [t, visionReady]);

  const history = useEditorHistory();

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

      <ToolbarOverflow controls={controls} label={t(($) => $.editor.toolbar.moreOptions)} />

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

import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignLeft,
  ArrowRight,
  ArrowRightToLine,
  Asterisk,
  Bold,
  BookmarkPlus,
  Code,
  Divide,
  FileDown,
  Hash,
  Heading,
  Image,
  Italic,
  Link,
  List,
  MessageSquareCode,
  Pencil,
  Quote,
  Rows3,
  SearchCode,
  Sigma,
  Sparkles,
  SquareSigma,
  Strikethrough,
  Table,
  Tag,
  Underline,
} from "lucide-react";
import { shortcut } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { getEditorView, insertAtCursor, wrapSelection } from "./cm/controller";
import { openInlineEdit } from "./cm/inline-ai/openSession";
import { formatWithLanguageService, type FormatScope } from "./cm/language-service-format";
import {
  explainMissingAnalysis,
  findReferences,
  goToDefinition,
  showLookupResult,
  startRename,
} from "@/lib/index/nav";
import { goToSyncTex } from "@/features/synctex";
import { engineSyncsPath, sourceLanguageForPath } from "@/lib/document-engine";
import { saveEquationAsPng, saveEquationAsSvg } from "@/features/equation-export";
import { convertLatexMathAtSelection } from "./convert-latex-math";
import { useTableImportStore } from "@/store/table-import";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
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
  insertLabel,
  insertRef,
  insertTable,
  insertUnderline,
} from "@/components/editor/latex-commands";
import {
  TYPST_HEADING_LEVELS,
  addTypstLabel,
  insertTypstAlignedMath,
  insertTypstBold,
  insertTypstBulletList,
  insertTypstDisplayMath,
  insertTypstFigure,
  insertTypstFootnote,
  insertTypstFraction,
  insertTypstHeading,
  insertTypstItalic,
  insertTypstLink,
  insertTypstMath,
  insertTypstNumberedEquation,
  insertTypstNumberedList,
  insertTypstQuote,
  insertTypstRawInline,
  insertTypstReference,
  insertTypstStrikethrough,
  insertTypstTable,
  insertTypstUnderline,
  toggleTypstComment,
  typstLanguageServiceOffers,
} from "@/components/editor/typst-commands";

interface EditorContextMenuProps {
  children: ReactNode;
}

function placeCursorAtContextPoint(event: MouseEvent<HTMLDivElement>) {
  const view = getEditorView();
  const position = view?.posAtCoords({
    x: event.clientX,
    y: event.clientY,
  });
  if (view && position != null) {
    const selection = view.state.selection.main;
    if (!selection.empty && position >= selection.from && position <= selection.to) return;
    view.dispatch({ selection: { anchor: position } });
  }
}

function runLanguageServiceFormat(scope: FormatScope) {
  const view = getEditorView();
  if (!view) return;
  void formatWithLanguageService(view, scope);
}

function openAskAi() {
  const view = getEditorView();
  if (view) openInlineEdit(view);
}

function TypstNavigationItems({ pdfSync }: Readonly<{ pdfSync: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const definition = typstLanguageServiceOffers("definition");
  const references = typstLanguageServiceOffers("references");
  const rename = typstLanguageServiceOffers("rename");
  if (!pdfSync && !definition && !references && !rename) return null;
  const run = (action: (view: NonNullable<ReturnType<typeof getEditorView>>) => boolean) => {
    const view = getEditorView();
    if (view) action(view);
  };
  return (
    <>
      {pdfSync && (
        <ContextMenuItem onClick={goToSyncTex}>
          <ArrowRight className="mr-2 size-4" /> {t(($) => $.editor.toolbar.goToPdfTypst)}
        </ContextMenuItem>
      )}
      {definition && (
        <ContextMenuItem onClick={() => run(goToDefinition)}>
          <ArrowRightToLine className="mr-2 size-4" /> {t(($) => $.editor.toolbar.goToDefinition)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("F12")}</span>
        </ContextMenuItem>
      )}
      {references && (
        <ContextMenuItem onClick={() => run(findReferences)}>
          <SearchCode className="mr-2 size-4" /> {t(($) => $.editor.toolbar.findReferences)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⇧F12")}</span>
        </ContextMenuItem>
      )}
      {rename && (
        <ContextMenuItem onClick={() => run(startRename)}>
          <Pencil className="mr-2 size-4" /> {t(($) => $.editor.toolbar.renameSymbol)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("F2")}</span>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
    </>
  );
}

function TypstMenuItems({
  onTableFromFile,
  pdfSync,
}: Readonly<{ onTableFromFile: () => void; pdfSync: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <>
      <ContextMenuItem onClick={openAskAi}>
        <Sparkles className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.askAi)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘L")}</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <TypstNavigationItems pdfSync={pdfSync} />
      <ContextMenuItem onClick={insertTypstBold}>
        <Bold className="mr-2 size-4" /> {t(($) => $.editor.toolbar.bold)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘B")}</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstItalic}>
        <Italic className="mr-2 size-4" /> {t(($) => $.editor.toolbar.italic)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘I")}</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstUnderline}>
        <Underline className="mr-2 size-4" /> {t(($) => $.editor.toolbar.underline)}
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstStrikethrough}>
        <Strikethrough className="mr-2 size-4" /> {t(($) => $.editor.toolbar.strikethrough)}
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstRawInline}>
        <Code className="mr-2 size-4" /> {t(($) => $.editor.toolbar.inlineCode)}
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstLink}>
        <Link className="mr-2 size-4" /> {t(($) => $.editor.toolbar.insertLink)}
      </ContextMenuItem>
      <ContextMenuItem onClick={toggleTypstComment}>
        <MessageSquareCode className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.toggleComment)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘/")}</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Heading className="mr-2 size-4" /> {t(($) => $.editor.toolbar.heading)}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-44">
          {TYPST_HEADING_LEVELS.map((level) => (
            <ContextMenuItem key={level.hLabel} onClick={() => insertTypstHeading(level)}>
              {level.label()}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <List className="mr-2 size-4" /> {t(($) => $.editor.toolbar.list)}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-44">
          <ContextMenuItem onClick={insertTypstBulletList}>{t(($) => $.editor.toolbar.bulletedList)}</ContextMenuItem>
          <ContextMenuItem onClick={insertTypstNumberedList}>{t(($) => $.editor.toolbar.numberedList)}</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onClick={() => void insertTypstFigure()}>
        <Image className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.figure)}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void insertTypstTable(3, 3)}>
        <Table className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.table)}
      </ContextMenuItem>
      <ContextMenuItem onClick={onTableFromFile} data-testid="context-table-from-file">
        <Table className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.tableFromFile)}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={insertTypstMath}>
        <Sigma className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.inlineMath)}
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstDisplayMath}>
        <SquareSigma className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.displayMath)}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void insertTypstNumberedEquation()}>
        <Hash className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.numberedEquation)}
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstAlignedMath}>
        <Rows3 className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.alignedEquations)}
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstFraction}>
        <Divide className="mr-2 size-4" /> {t(($) => $.editor.toolbar.fraction)}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void saveEquationAsSvg()} data-testid="context-export-equation-svg">
        <FileDown className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.equationAsSvg)}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void saveEquationAsPng()} data-testid="context-export-equation-png">
        <FileDown className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.equationAsPng)}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void convertLatexMathAtSelection()} data-testid="context-convert-latex-math">
        <Sigma className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.convertLatexMath)}
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstQuote}>
        <Quote className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.quote)}
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstFootnote}>
        <Asterisk className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.footnote)}
      </ContextMenuItem>
      <ContextMenuItem onClick={insertTypstReference}>
        <Tag className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.crossReference)}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void addTypstLabel()}>
        <BookmarkPlus className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.addLabel)}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => runLanguageServiceFormat("document")}>
        <AlignLeft className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.formatDocument)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⇧⌥F")}</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={() => runLanguageServiceFormat("selection")}>
        <AlignLeft className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.formatSelection)}
      </ContextMenuItem>
    </>
  );
}

export function EditorContextMenu({ children }: Readonly<EditorContextMenuProps>) {
  const { t } = useTranslation(["common", "editor"]);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const menuProfile = useFilesStore((s) =>
    sourceLanguageForPath(s.activePath) ??
    (s.engineLoaded ? s.engine.capabilities.formatting_profile : "none"),
  );
  const isTypst = menuProfile === "typst";
  const isMarkdown = menuProfile === "markdown";
  const projectKind = useFilesStore((s) => s.projectKind);
  const engine = useFilesStore((s) => s.engine);
  const activePath = useFilesStore((s) => s.activePath);
  const syncTexSupported =
    projectKind !== "image" && projectKind !== "diagram" && engineLoaded && engineSyncsPath(engine, activePath);
  const setTableImportOpen = useTableImportStore((state) => state.setOpen);
  if (!engineLoaded) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={placeCursorAtContextPoint}>
          <div className="h-full">{children}</div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem disabled>{t(($) => $.editor.contextMenu.engineUnavailable)}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  if (isTypst) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={placeCursorAtContextPoint}>
          <div className="h-full">{children}</div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <TypstMenuItems
            onTableFromFile={() => setTableImportOpen(true)}
            pdfSync={syncTexSupported && engine.id === "typst"}
          />
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  if (isMarkdown) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={placeCursorAtContextPoint}>
          <div className="h-full">{children}</div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onClick={() => { const view = getEditorView(); if (view) openInlineEdit(view); }}>
            <Sparkles className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.askAi)}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => wrapSelection("**", "**")}>
            <Bold className="mr-2 size-4" /> {t(($) => $.editor.toolbar.bold)}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => wrapSelection("*", "*")}>
            <Italic className="mr-2 size-4" /> {t(($) => $.editor.toolbar.italic)}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => insertAtCursor("# Heading\n")}>
            <Heading className="mr-2 size-4" /> {t(($) => $.editor.toolbar.heading)}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => insertAtCursor("- Item\n")}>
            <List className="mr-2 size-4" /> {t(($) => $.editor.toolbar.bulletedList)}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={placeCursorAtContextPoint}>
        <div className="h-full">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view) openInlineEdit(view);
          }}
        >
          <Sparkles className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.askAi)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘L")}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {syncTexSupported && (
          <ContextMenuItem onClick={goToSyncTex}>
            <ArrowRight className="mr-2 size-4" /> {t(($) => $.editor.toolbar.goToPdf)}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view && !goToDefinition(view)) {
              showLookupResult(t(($) => $.editor.contextMenu.noIndexedSymbol));
            }
          }}
        >
          <ArrowRightToLine className="mr-2 size-4" /> {t(($) => $.editor.toolbar.goToDefinition)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("F12")}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view && !findReferences(view)) {
              showLookupResult(t(($) => $.editor.contextMenu.noIndexedSymbol));
            }
          }}
        >
          <SearchCode className="mr-2 size-4" /> {t(($) => $.editor.toolbar.findReferences)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⇧F12")}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (!view || startRename(view)) return;
            if (useIndexStore.getState().index) {
              showLookupResult(t(($) => $.editor.contextMenu.noRenamableSymbol));
            } else {
              explainMissingAnalysis(view.state.doc.toString());
            }
          }}
        >
          <Pencil className="mr-2 size-4" /> {t(($) => $.editor.toolbar.renameSymbol)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("F2")}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={insertBold}>
          <Bold className="mr-2 size-4" /> {t(($) => $.editor.toolbar.bold)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘B")}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={insertItalic}>
          <Italic className="mr-2 size-4" /> {t(($) => $.editor.toolbar.italic)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘I")}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={insertUnderline}>
          <Underline className="mr-2 size-4" /> {t(($) => $.editor.toolbar.underline)}
        </ContextMenuItem>
        <ContextMenuItem onClick={insertCode}>
          <Code className="mr-2 size-4" /> {t(($) => $.editor.toolbar.inlineCode)}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Heading className="mr-2 size-4" /> {t(($) => $.editor.toolbar.heading)}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {HEADING_LEVELS.map((level) => (
              <ContextMenuItem key={level.hLabel} onClick={() => insertHeading(level)}>
                {level.label()}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <List className="mr-2 size-4" /> {t(($) => $.editor.toolbar.list)}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuItem onClick={insertItemize}>{t(($) => $.editor.contextMenu.itemize)}</ContextMenuItem>
            <ContextMenuItem onClick={insertEnumerate}>{t(($) => $.editor.contextMenu.enumerate)}</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onClick={insertFigure}>
          <Image className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.figure)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => insertTable(3, 3)}>
          <Table className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.table)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => setTableImportOpen(true)} data-testid="context-table-from-file">
          <Table className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.tableFromFile)}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={insertAlign}>
          <Rows3 className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.align)}
        </ContextMenuItem>
        <ContextMenuItem onClick={insertEquation}>
          <Sigma className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.equation)}
        </ContextMenuItem>
        <ContextMenuItem onClick={insertFraction}>
          <Divide className="mr-2 size-4" /> {t(($) => $.editor.toolbar.fraction)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void saveEquationAsSvg()} data-testid="context-export-equation-svg">
          <FileDown className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.equationAsSvg)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void saveEquationAsPng()} data-testid="context-export-equation-png">
          <FileDown className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.equationAsPng)}
        </ContextMenuItem>
        <ContextMenuItem onClick={insertBlockquote}>
          <Quote className="mr-2 size-4" /> {t(($) => $.editor.toolbar.blockquote)}
        </ContextMenuItem>
        <ContextMenuItem onClick={insertFootnote}>
          <Asterisk className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.footnote)}
        </ContextMenuItem>
        <ContextMenuItem onClick={insertRef}>
          <Tag className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.crossReference)}
        </ContextMenuItem>
        <ContextMenuItem onClick={insertLabel}>
          <Tag className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.label)}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

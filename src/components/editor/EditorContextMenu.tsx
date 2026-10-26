import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EditorView } from "@codemirror/view";
import {
  AlignLeft,
  ArrowDownUp,
  ArrowRight,
  ArrowRightToLine,
  Asterisk,
  Bold,
  BookmarkPlus,
  ClipboardPaste,
  Code,
  Copy,
  Divide,
  FileDown,
  FilePen,
  Hash,
  Heading,
  Image,
  Italic,
  Link,
  List,
  type LucideIcon,
  MessageSquareCode,
  MessageSquarePlus,
  Pencil,
  Plus,
  Quote,
  Rows3,
  Scissors,
  SearchCode,
  Sigma,
  Sparkles,
  SquareSigma,
  Strikethrough,
  Table,
  Tag,
  TextSelect,
  Type,
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
import { getEditorView, insertAtCursor, wrapSelection, wrapSelectionOrPlaceholder } from "./cm/controller";
import { commentTarget, requestComment, useCommentsRail } from "@/components/collab/comments-rail";
import { useCollabReady } from "@/components/collab/CollabSlots";
import { openInlineEdit } from "./cm/inline-ai/openSession";
import { formatWithLanguageService, type FormatScope } from "./cm/language-service-format";
import { copySelection, cutSelection, hasSelectedText, pasteClipboard, selectAllText } from "./clipboard-commands";
import {
  explainMissingAnalysis,
  findReferences,
  goToDefinition,
  showLookupResult,
  startRename,
} from "@/lib/index/nav";
import { useFileRename } from "@/lib/file-references/rename-trigger";
import { goToSyncTex } from "@/features/synctex";
import { engineSyncsPath, sourceLanguageForPath } from "@/lib/document-engine";
import { saveEquationAsPng, saveEquationAsSvg } from "@/features/equation-export";
import { convertLatexMathAtSelection } from "./convert-latex-math";
import { insertMarkdownTable } from "./markdown-commands";
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

function withView(action: (view: EditorView) => unknown) {
  const view = getEditorView();
  if (view) void action(view);
}

function useFileRenameAvailable(): boolean {
  const fileRename = useFileRename();
  const view = getEditorView();
  return fileRename !== null && view !== null && fileRename.pathReferenceUnderCursor(view) !== null;
}

function RenameFileMenuItem({ separator = false }: Readonly<{ separator?: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const fileRename = useFileRename();
  const view = getEditorView();
  if (!fileRename || !view || !fileRename.pathReferenceUnderCursor(view)) return null;
  return (
    <>
      <ContextMenuItem
        data-testid="context-rename-file"
        onClick={() => {
          const current = getEditorView();
          if (current) fileRename.startFileRenameAtCursor(current);
        }}
      >
        <FilePen className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.renameFile)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("F2")}</span>
      </ContextMenuItem>
      {separator && <ContextMenuSeparator />}
    </>
  );
}

function CommentMenuEntry() {
  const { t } = useTranslation(["collab"]);
  const target = commentTarget(getEditorView());
  return (
    <ContextMenuItem
      data-testid="context-comment"
      disabled={!target}
      onClick={() => requestComment(getEditorView())}
    >
      <MessageSquarePlus className="mr-2 size-4" /> {t(($) => $.collab.comments.add)}
      <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘⌥M")}</span>
    </ContextMenuItem>
  );
}

function CommentMenuItem() {
  const ready = useCollabReady();
  const canCompose = useCommentsRail((state) => state.canCompose);
  return ready && canCompose ? <CommentMenuEntry /> : null;
}

// Rendered when the menu opens, so the enabled state reflects the selection
// the right-click left behind.
function ClipboardMenuItems() {
  const { t } = useTranslation(["common", "editor"]);
  const view = getEditorView();
  const selected = view !== null && hasSelectedText(view.state);
  const readOnly = !view || view.state.readOnly;
  return (
    <>
      <ContextMenuItem disabled={!selected || readOnly} onClick={() => withView(cutSelection)}>
        <Scissors className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.cut)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘X")}</span>
      </ContextMenuItem>
      <ContextMenuItem disabled={!selected} onClick={() => withView(copySelection)}>
        <Copy className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.copy)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘C")}</span>
      </ContextMenuItem>
      <ContextMenuItem disabled={readOnly} onClick={() => withView(pasteClipboard)}>
        <ClipboardPaste className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.paste)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘V")}</span>
      </ContextMenuItem>
      <ContextMenuItem disabled={!view} onClick={() => withView(selectAllText)}>
        <TextSelect className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.selectAll)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘A")}</span>
      </ContextMenuItem>
    </>
  );
}

function EditMenuItems() {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <>
      <ContextMenuItem onClick={() => withView(openInlineEdit)}>
        <Sparkles className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.askAi)}
        <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘L")}</span>
      </ContextMenuItem>
      <CommentMenuItem />
      <ContextMenuSeparator />
      <ClipboardMenuItems />
      <ContextMenuSeparator />
    </>
  );
}

function Submenu({
  icon: Icon,
  label,
  className = "w-56",
  children,
}: Readonly<{ icon: LucideIcon; label: string; className?: string; children: ReactNode }>) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Icon className="mr-2 size-4" /> {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className={className}>{children}</ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function ImportExportSubmenu({ children }: Readonly<{ children?: ReactNode }>) {
  const { t } = useTranslation(["common", "editor"]);
  const setTableImportOpen = useTableImportStore((state) => state.setOpen);
  return (
    <Submenu icon={ArrowDownUp} label={t(($) => $.editor.contextMenu.importExport)} className="w-64">
      <ContextMenuItem onClick={() => setTableImportOpen(true)} data-testid="context-table-from-file">
        <Table className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.tableFromFile)}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void saveEquationAsSvg()} data-testid="context-export-equation-svg">
        <FileDown className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.equationAsSvg)}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void saveEquationAsPng()} data-testid="context-export-equation-png">
        <FileDown className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.equationAsPng)}
      </ContextMenuItem>
      {children}
    </Submenu>
  );
}

function TypstNavigationItems({ pdfSync }: Readonly<{ pdfSync: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const definition = typstLanguageServiceOffers("definition");
  const references = typstLanguageServiceOffers("references");
  const rename = typstLanguageServiceOffers("rename");
  const renameFile = useFileRenameAvailable();
  if (!pdfSync && !definition && !references && !rename && !renameFile) return null;
  return (
    <>
      {pdfSync && (
        <ContextMenuItem onClick={goToSyncTex}>
          <ArrowRight className="mr-2 size-4" /> {t(($) => $.editor.toolbar.goToPdfTypst)}
        </ContextMenuItem>
      )}
      {definition && (
        <ContextMenuItem onClick={() => withView(goToDefinition)}>
          <ArrowRightToLine className="mr-2 size-4" /> {t(($) => $.editor.toolbar.goToDefinition)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("F12")}</span>
        </ContextMenuItem>
      )}
      {references && (
        <ContextMenuItem onClick={() => withView(findReferences)}>
          <SearchCode className="mr-2 size-4" /> {t(($) => $.editor.toolbar.findReferences)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⇧F12")}</span>
        </ContextMenuItem>
      )}
      {rename && (
        <ContextMenuItem onClick={() => withView(startRename)}>
          <Pencil className="mr-2 size-4" /> {t(($) => $.editor.toolbar.renameSymbol)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("F2")}</span>
        </ContextMenuItem>
      )}
      <RenameFileMenuItem />
      <ContextMenuSeparator />
    </>
  );
}

function TypstMenuItems({ pdfSync }: Readonly<{ pdfSync: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <>
      <TypstNavigationItems pdfSync={pdfSync} />
      <Submenu icon={Type} label={t(($) => $.editor.contextMenu.format)}>
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
      </Submenu>
      <Submenu icon={Plus} label={t(($) => $.editor.contextMenu.insert)}>
        <Submenu icon={Heading} label={t(($) => $.editor.toolbar.heading)} className="w-44">
          {TYPST_HEADING_LEVELS.map((level) => (
            <ContextMenuItem key={level.hLabel} onClick={() => insertTypstHeading(level)}>
              {level.label()}
            </ContextMenuItem>
          ))}
        </Submenu>
        <Submenu icon={List} label={t(($) => $.editor.toolbar.list)} className="w-44">
          <ContextMenuItem onClick={insertTypstBulletList}>{t(($) => $.editor.toolbar.bulletedList)}</ContextMenuItem>
          <ContextMenuItem onClick={insertTypstNumberedList}>{t(($) => $.editor.toolbar.numberedList)}</ContextMenuItem>
        </Submenu>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => void insertTypstFigure()}>
          <Image className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.figure)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void insertTypstTable(3, 3)}>
          <Table className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.table)}
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
        <ContextMenuSeparator />
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
      </Submenu>
      <ImportExportSubmenu>
        <ContextMenuItem onClick={() => void convertLatexMathAtSelection()} data-testid="context-convert-latex-math">
          <Sigma className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.convertLatexMath)}
        </ContextMenuItem>
      </ImportExportSubmenu>
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

function MarkdownMenuItems() {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <>
      <RenameFileMenuItem separator />
      <Submenu icon={Type} label={t(($) => $.editor.contextMenu.format)}>
        <ContextMenuItem onClick={() => wrapSelection("**", "**")}>
          <Bold className="mr-2 size-4" /> {t(($) => $.editor.toolbar.bold)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => wrapSelection("*", "*")}>
          <Italic className="mr-2 size-4" /> {t(($) => $.editor.toolbar.italic)}
        </ContextMenuItem>
      </Submenu>
      <Submenu icon={Plus} label={t(($) => $.editor.contextMenu.insert)}>
        <ContextMenuItem onClick={() => insertAtCursor("# Heading\n")}>
          <Heading className="mr-2 size-4" /> {t(($) => $.editor.toolbar.heading)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => insertAtCursor("- Item\n")}>
          <List className="mr-2 size-4" /> {t(($) => $.editor.toolbar.bulletedList)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => insertMarkdownTable(3, 3)}>
          <Table className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.table)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => wrapSelectionOrPlaceholder("$$\n", "\n$$\n", "")}>
          <Sigma className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.equation)}
        </ContextMenuItem>
      </Submenu>
    </>
  );
}

function LatexNavigationItems({ pdfSync }: Readonly<{ pdfSync: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <>
      {pdfSync && (
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
      <RenameFileMenuItem />
      <ContextMenuSeparator />
    </>
  );
}

function LatexMenuItems({ pdfSync }: Readonly<{ pdfSync: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <>
      <LatexNavigationItems pdfSync={pdfSync} />
      <Submenu icon={Type} label={t(($) => $.editor.contextMenu.format)}>
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
      </Submenu>
      <Submenu icon={Plus} label={t(($) => $.editor.contextMenu.insert)}>
        <Submenu icon={Heading} label={t(($) => $.editor.toolbar.heading)} className="w-44">
          {HEADING_LEVELS.map((level) => (
            <ContextMenuItem key={level.hLabel} onClick={() => insertHeading(level)}>
              {level.label()}
            </ContextMenuItem>
          ))}
        </Submenu>
        <Submenu icon={List} label={t(($) => $.editor.toolbar.list)} className="w-44">
          <ContextMenuItem onClick={insertItemize}>{t(($) => $.editor.contextMenu.itemize)}</ContextMenuItem>
          <ContextMenuItem onClick={insertEnumerate}>{t(($) => $.editor.contextMenu.enumerate)}</ContextMenuItem>
        </Submenu>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={insertFigure}>
          <Image className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.figure)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => insertTable(3, 3)}>
          <Table className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.table)}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={insertEquation}>
          <Sigma className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.equation)}
        </ContextMenuItem>
        <ContextMenuItem onClick={insertAlign}>
          <Rows3 className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.align)}
        </ContextMenuItem>
        <ContextMenuItem onClick={insertFraction}>
          <Divide className="mr-2 size-4" /> {t(($) => $.editor.toolbar.fraction)}
        </ContextMenuItem>
        <ContextMenuSeparator />
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
      </Submenu>
      <ImportExportSubmenu />
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
  const projectKind = useFilesStore((s) => s.projectKind);
  const engine = useFilesStore((s) => s.engine);
  const activePath = useFilesStore((s) => s.activePath);
  const syncTexSupported =
    projectKind !== "image" && projectKind !== "diagram" && engineLoaded && engineSyncsPath(engine, activePath);
  let items: ReactNode;
  if (!engineLoaded) {
    items = <ContextMenuItem disabled>{t(($) => $.editor.contextMenu.engineUnavailable)}</ContextMenuItem>;
  } else if (menuProfile === "typst") {
    items = <TypstMenuItems pdfSync={syncTexSupported && engine.id === "typst"} />;
  } else if (menuProfile === "markdown") {
    items = <MarkdownMenuItems />;
  } else {
    items = <LatexMenuItems pdfSync={syncTexSupported} />;
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={placeCursorAtContextPoint}>
        <div className="h-full">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {engineLoaded && <EditMenuItems />}
        {items}
      </ContextMenuContent>
    </ContextMenu>
  );
}

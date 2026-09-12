import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ArrowRightToLine,
  Asterisk,
  Bold,
  Code,
  Divide,
  Heading,
  Image,
  Italic,
  List,
  Pencil,
  Quote,
  Rows3,
  SearchCode,
  Sigma,
  Sparkles,
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
import { goToDefinition, findReferences, startRename } from "@/lib/index/nav";
import { goToSyncTex } from "@/features/synctex";
import { useFilesStore } from "@/store/files";
import { toast } from "@/lib/toast";
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
    view.dispatch({ selection: { anchor: position } });
  }
}

export function EditorContextMenu({ children }: Readonly<EditorContextMenuProps>) {
  const { t } = useTranslation(["common", "editor"]);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const isTypst = useFilesStore((s) => s.engineLoaded && s.engine.capabilities.formatting_profile === "typst");
  const isMarkdown = useFilesStore((s) => s.engineLoaded && s.engine.capabilities.formatting_profile === "markdown");
  const projectKind = useFilesStore((s) => s.projectKind);
  const engine = useFilesStore((s) => s.engine);
  const syncTexSupported =
    projectKind !== "image" && projectKind !== "diagram" && engineLoaded && engine.capabilities.supports_synctex;
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
          <ContextMenuItem onClick={() => { const view = getEditorView(); if (view) openInlineEdit(view); }}>
            <Sparkles className="mr-2 size-4" /> {t(($) => $.editor.contextMenu.askAi)}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => wrapSelection("*", "*")}>
            <Bold className="mr-2 size-4" /> {t(($) => $.editor.toolbar.bold)}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => wrapSelection("_", "_")}>
            <Italic className="mr-2 size-4" /> {t(($) => $.editor.toolbar.italic)}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => insertAtCursor("= Heading\n")}>
            <Heading className="mr-2 size-4" /> {t(($) => $.editor.toolbar.heading)}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => insertAtCursor("- Item\n")}>
            <List className="mr-2 size-4" /> {t(($) => $.editor.toolbar.bulletedList)}
          </ContextMenuItem>
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
              toast.info(t(($) => $.editor.contextMenu.noIndexedSymbol));
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
              toast.info(t(($) => $.editor.contextMenu.noIndexedSymbol));
            }
          }}
        >
          <SearchCode className="mr-2 size-4" /> {t(($) => $.editor.toolbar.findReferences)}
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⇧F12")}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view && !startRename(view)) {
              toast.info(t(($) => $.editor.contextMenu.noRenamableSymbol));
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

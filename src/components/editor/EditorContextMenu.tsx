import type { MouseEvent, ReactNode } from "react";
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

export function EditorContextMenu({ children }: EditorContextMenuProps) {
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const isTypst = useFilesStore((s) => s.engineLoaded && s.engine.capabilities.formatting_profile === "typst");
  const isMarkdown = useFilesStore((s) => s.engineLoaded && s.engine.capabilities.formatting_profile === "markdown");
  const projectKind = useFilesStore((s) => s.projectKind);
  const engine = useFilesStore((s) => s.engine);
  const syncTexSupported = projectKind !== "image" && engineLoaded && engine.capabilities.supports_synctex;
  if (!engineLoaded) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={placeCursorAtContextPoint}>
          <div className="h-full">{children}</div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem disabled>Document engine actions unavailable</ContextMenuItem>
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
            <Sparkles className="mr-2 size-4" /> Ask AI…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => wrapSelection("*", "*")}>
            <Bold className="mr-2 size-4" /> Bold
          </ContextMenuItem>
          <ContextMenuItem onClick={() => wrapSelection("_", "_")}>
            <Italic className="mr-2 size-4" /> Italic
          </ContextMenuItem>
          <ContextMenuItem onClick={() => insertAtCursor("= Heading\n")}>
            <Heading className="mr-2 size-4" /> Heading
          </ContextMenuItem>
          <ContextMenuItem onClick={() => insertAtCursor("- Item\n")}>
            <List className="mr-2 size-4" /> Bulleted list
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
            <Sparkles className="mr-2 size-4" /> Ask AI…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => wrapSelection("**", "**")}><Bold className="mr-2 size-4" /> Bold</ContextMenuItem>
          <ContextMenuItem onClick={() => wrapSelection("*", "*")}><Italic className="mr-2 size-4" /> Italic</ContextMenuItem>
          <ContextMenuItem onClick={() => insertAtCursor("# Heading\n")}><Heading className="mr-2 size-4" /> Heading</ContextMenuItem>
          <ContextMenuItem onClick={() => insertAtCursor("- Item\n")}><List className="mr-2 size-4" /> Bulleted list</ContextMenuItem>
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
          <Sparkles className="mr-2 size-4" /> Ask AI…
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘L")}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {syncTexSupported && (
          <ContextMenuItem onClick={goToSyncTex}>
            <ArrowRight className="mr-2 size-4" /> Go to PDF (SyncTeX)
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view && !goToDefinition(view)) {
              toast.info("No indexed symbol at this location.");
            }
          }}
        >
          <ArrowRightToLine className="mr-2 size-4" /> Go to definition
          <span className="ml-auto text-xs text-muted-foreground">F12</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view && !findReferences(view)) {
              toast.info("No indexed symbol at this location.");
            }
          }}
        >
          <SearchCode className="mr-2 size-4" /> Find references
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⇧F12")}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view && !startRename(view)) {
              toast.info("No renamable symbol at this location.");
            }
          }}
        >
          <Pencil className="mr-2 size-4" /> Rename symbol
          <span className="ml-auto text-xs text-muted-foreground">F2</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={insertBold}>
          <Bold className="mr-2 size-4" /> Bold
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘B")}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={insertItalic}>
          <Italic className="mr-2 size-4" /> Italic
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘I")}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={insertUnderline}>
          <Underline className="mr-2 size-4" /> Underline
        </ContextMenuItem>
        <ContextMenuItem onClick={insertCode}>
          <Code className="mr-2 size-4" /> Inline code
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Heading className="mr-2 size-4" /> Heading
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {HEADING_LEVELS.map((level) => (
              <ContextMenuItem key={level.label} onClick={() => insertHeading(level)}>
                {level.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <List className="mr-2 size-4" /> List
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuItem onClick={insertItemize}>Itemize</ContextMenuItem>
            <ContextMenuItem onClick={insertEnumerate}>Enumerate</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onClick={insertFigure}>
          <Image className="mr-2 size-4" /> Figure
        </ContextMenuItem>
        <ContextMenuItem onClick={() => insertTable(3, 3)}>
          <Table className="mr-2 size-4" /> Table
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={insertAlign}>
          <Rows3 className="mr-2 size-4" /> Align
        </ContextMenuItem>
        <ContextMenuItem onClick={insertEquation}>
          <Sigma className="mr-2 size-4" /> Equation
        </ContextMenuItem>
        <ContextMenuItem onClick={insertFraction}>
          <Divide className="mr-2 size-4" /> Fraction
        </ContextMenuItem>
        <ContextMenuItem onClick={insertBlockquote}>
          <Quote className="mr-2 size-4" /> Blockquote
        </ContextMenuItem>
        <ContextMenuItem onClick={insertFootnote}>
          <Asterisk className="mr-2 size-4" /> Footnote
        </ContextMenuItem>
        <ContextMenuItem onClick={insertRef}>
          <Tag className="mr-2 size-4" /> Cross-reference
        </ContextMenuItem>
        <ContextMenuItem onClick={insertLabel}>
          <Tag className="mr-2 size-4" /> Label
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

import type { ReactNode } from "react";
import { Bold, Italic, Heading, List, Image, Table, Sigma, Sparkles, Tag, ArrowRightToLine, SearchCode, Pencil } from "lucide-react";
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
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";

interface EditorContextMenuProps {
  children: ReactNode;
}

export function EditorContextMenu({ children }: EditorContextMenuProps) {
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const isTypst = useFilesStore((s) => s.engineLoaded && s.engine.capabilities.formatting_profile === "typst");
  const isMarkdown = useFilesStore((s) => s.engineLoaded && s.engine.capabilities.formatting_profile === "markdown");
  if (!engineLoaded) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild><div className="h-full">{children}</div></ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem disabled>Document engine actions unavailable</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  if (isTypst) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild><div className="h-full">{children}</div></ContextMenuTrigger>
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
        <ContextMenuTrigger asChild><div className="h-full">{children}</div></ContextMenuTrigger>
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
      <ContextMenuTrigger asChild>
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
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            const sel = view?.state.selection.main;
            const text = sel && !sel.empty ? view!.state.sliceDoc(sel.from, sel.to) : "";
            const s = useSettingsStore.getState();
            s.setRailTab("ai");
            if (!s.showTree) s.toggleTree();
            s.setFigureModeOpen(true);
            window.dispatchEvent(
              new CustomEvent("openleaf:figure-from-selection", { detail: { text } }),
            );
          }}
        >
          <Image className="mr-2 size-4" /> Generate figure from selection
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view) goToDefinition(view);
          }}
        >
          <ArrowRightToLine className="mr-2 size-4" /> Go to definition
          <span className="ml-auto text-xs text-muted-foreground">F12</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view) findReferences(view);
          }}
        >
          <SearchCode className="mr-2 size-4" /> Find references
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⇧F12")}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const view = getEditorView();
            if (view) startRename(view);
          }}
        >
          <Pencil className="mr-2 size-4" /> Rename symbol
          <span className="ml-auto text-xs text-muted-foreground">F2</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => wrapSelection("\\textbf{", "}")}>
          <Bold className="mr-2 size-4" /> Bold
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘B")}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => wrapSelection("\\textit{", "}")}>
          <Italic className="mr-2 size-4" /> Italic
          <span className="ml-auto text-xs text-muted-foreground">{shortcut("⌘I")}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Heading className="mr-2 size-4" /> Heading
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuItem onClick={() => insertAtCursor("\\section{}\n")}>
              \section
            </ContextMenuItem>
            <ContextMenuItem onClick={() => insertAtCursor("\\subsection{}\n")}>
              \subsection
            </ContextMenuItem>
            <ContextMenuItem onClick={() => insertAtCursor("\\subsubsection{}\n")}>
              \subsubsection
            </ContextMenuItem>
            <ContextMenuItem onClick={() => insertAtCursor("\\paragraph{}\n")}>
              \paragraph
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <List className="mr-2 size-4" /> List
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuItem
              onClick={() =>
                insertAtCursor("\\begin{itemize}\n  \\item \n\\end{itemize}\n")
              }
            >
              Itemize
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                insertAtCursor("\\begin{enumerate}\n  \\item \n\\end{enumerate}\n")
              }
            >
              Enumerate
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem
          onClick={() =>
            insertAtCursor(
              "\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{}\n  \\caption{}\n\\end{figure}\n"
            )
        }
        >
          <Image className="mr-2 size-4" /> Figure
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            insertAtCursor(
              "\\begin{table}[h]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{ll}\n    & \\\\\n  \\end{tabular}\n\\end{table}\n"
            )
          }
        >
          <Table className="mr-2 size-4" /> Table
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => insertAtCursor("\\begin{equation}\n  \n\\end{equation}\n")}
        >
          <Sigma className="mr-2 size-4" /> Equation
        </ContextMenuItem>
        <ContextMenuItem onClick={() => insertAtCursor("\\label{}\n")}>
          <Tag className="mr-2 size-4" /> Label
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

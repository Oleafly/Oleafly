import type { ReactNode } from "react";
import { Bold, Italic, Heading, List, Image, Table, Sigma, Sparkles, Tag } from "lucide-react";
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

interface EditorContextMenuProps {
  children: ReactNode;
}

export function EditorContextMenu({ children }: EditorContextMenuProps) {
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
          <span className="ml-auto text-xs text-muted-foreground">⌘L</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => wrapSelection("\\textbf{", "}")}>
          <Bold className="mr-2 size-4" /> Bold
          <span className="ml-auto text-xs text-muted-foreground">⌘B</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => wrapSelection("\\textit{", "}")}>
          <Italic className="mr-2 size-4" /> Italic
          <span className="ml-auto text-xs text-muted-foreground">⌘I</span>
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

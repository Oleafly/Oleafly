import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRightToLine,
  Bold,
  Braces,
  ChevronDown,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pencil,
  Quote,
  Redo2,
  Search,
  SearchCode,
  Table as TableIcon,
  Tag,
  Type,
  Undo2,
} from "lucide-react";
import { Popover, PopoverItem } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import {
  editorFind,
  editorRedo,
  editorUndo,
  getEditorView,
  insertAtCursor,
  wrapSelection,
} from "./cm/controller";
import { goToDefinition, findReferences, startRename } from "@/lib/index/nav";
import { imageToLatex, imageToLatexAvailable } from "@/features/image-to-latex";
import { useCitationStore } from "@/store/citation";
import { cn, shortcut } from "@/lib/utils";

function withView(fn: (v: import("@codemirror/view").EditorView) => void) {
  const v = getEditorView();
  if (v) fn(v);
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function IconBtn({
  onClick,
  title,
  children,
  wide,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Tooltip label={title} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
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

export function EditorToolbar() {
  const [visionReady, setVisionReady] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void imageToLatexAvailable().then(setVisionReady);
  }, []);
  return (
    <div className="flex h-9 items-center gap-0.5 border-b px-2">
      <IconBtn onClick={editorUndo} title={`Undo (${shortcut("⌘Z")})`}>
        <Undo2 className="size-4" />
      </IconBtn>
      <IconBtn onClick={editorRedo} title={`Redo (${shortcut("⌘⇧Z")})`}>
        <Redo2 className="size-4" />
      </IconBtn>

      <Divider />

      <Popover
        ariaLabel="Heading level"
        trigger={
          <span className="flex items-center gap-0.5">
            <Type className="size-4" />
            <ChevronDown className="size-3" />
          </span>
        }
      >
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Heading
        </div>
        {[
          ["Part", "\\part{", "text-base font-bold"],
          ["Chapter", "\\chapter{", "text-base font-bold"],
          ["Section", "\\section{", "text-sm font-bold"],
          ["Subsection", "\\subsection{", "text-sm font-semibold"],
          ["Subsubsection", "\\subsubsection{", "text-xs font-semibold"],
          ["Paragraph", "\\paragraph{", "text-xs font-medium"],
        ].map(([label, cmd, cls]) => (
          <PopoverItem key={label} onClick={() => insertAtCursor(`${cmd}}\n`)}>
            <span className={cls}>{label}</span>
          </PopoverItem>
        ))}
      </Popover>

      <Divider />

      <IconBtn onClick={() => wrapSelection("\\textbf{", "}")} title={`Bold (${shortcut("⌘B")})`}>
        <Bold className="size-4" />
      </IconBtn>
      <IconBtn onClick={() => wrapSelection("\\textit{", "}")} title={`Italic (${shortcut("⌘I")})`}>
        <Italic className="size-4" />
      </IconBtn>

      <Divider />

      <IconBtn onClick={() => insertAtCursor("\\href{}{}")} title="Insert link">
        <LinkIcon className="size-4" />
      </IconBtn>
      <IconBtn onClick={() => useCitationStore.getState().setOpen(true)} title="Add citation (DOI, arXiv, or title)">
        <Quote className="size-4" />
      </IconBtn>
      <IconBtn onClick={() => insertAtCursor("\\ref{}")} title="Insert cross-reference">
        <Tag className="size-4" />
      </IconBtn>
      <IconBtn
        onClick={() =>
          insertAtCursor(
            "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{}\n  \\caption{}\n\\end{figure}\n"
          )
        }
        title="Insert figure"
      >
        <ImageIcon className="size-4" />
      </IconBtn>
      <IconBtn
        onClick={() =>
          insertAtCursor(
            "\\begin{table}[htbp]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{ll}\n    & \\\\\n  \\end{tabular}\n\\end{table}\n"
          )
        }
        title="Insert table"
      >
        <TableIcon className="size-4" />
      </IconBtn>
      {visionReady && (
        <>
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
          <IconBtn
            onClick={() => imageInputRef.current?.click()}
            title="Image to LaTeX (transcribe with AI)"
          >
            <ImagePlus data-testid="image-to-latex" className="size-4" />
          </IconBtn>
        </>
      )}
      <Popover ariaLabel="Insert list" trigger={<List className="size-4" />}>
        <PopoverItem
          onClick={() => insertAtCursor("\\begin{itemize}\n  \\item \n\\end{itemize}\n")}
        >
          <List className="size-4" /> Bulleted list
        </PopoverItem>
        <PopoverItem
          onClick={() => insertAtCursor("\\begin{enumerate}\n  \\item \n\\end{enumerate}\n")}
        >
          <ListOrdered className="size-4" /> Numbered list
        </PopoverItem>
      </Popover>

      <Divider />

      {/* One compact dropdown so it never crowds the bar */}
      <Popover
        ariaLabel="Code intelligence"
        trigger={
          <span className="flex items-center gap-0.5">
            <Braces className="size-4" />
            <ChevronDown className="size-3" />
          </span>
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

      <div className="ml-auto flex items-center gap-0.5">
        <IconBtn onClick={editorFind} title={`Find (${shortcut("⌘F")})`}>
          <Search className="size-4" />
        </IconBtn>
      </div>
    </div>
  );
}

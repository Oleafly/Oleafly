import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { getChunks, unifiedMergeView } from "@codemirror/merge";
import { editorTheme } from "../cm/theme";
import { languageForPath } from "../cm/languages";
import { cn } from "@/lib/utils";

/** Above this size (per side) we skip the merge view — it isn't worth the jank. */
const MAX = 400_000;

/**
 * A compact, read-only red/green diff of two in-memory strings, rendered with
 * `@codemirror/merge`'s unified view (single column — deletions in red, additions
 * in green). Unlike `DiffView` this has no git or store coupling: give it the old
 * and new text and it renders. Used to preview an AI agent's proposed file edit
 * before the user approves it.
 */
export function InlineDiffPreview({
  path,
  oldText,
  newText,
  className,
  /** 1-based line in the new text to scroll into view after mount (fallback if chunks missing). */
  scrollToLine,
}: {
  path: string;
  oldText: string;
  newText: string;
  className?: string;
  scrollToLine?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";
    if (oldText.length > MAX || newText.length > MAX) {
      const note = document.createElement("div");
      note.className = "px-3 py-2 text-[11px] text-muted-foreground";
      note.textContent = "File too large to preview a diff.";
      host.appendChild(note);
      return;
    }
    const lang = languageForPath(path);
    // Height must live on the EditorView so .cm-scroller is the scroll container.
    // If the host grows with the full doc and a parent overflows, scrollIntoView is a no-op.
    const view = new EditorView({
      doc: newText,
      extensions: [
        unifiedMergeView({ original: oldText, mergeControls: false }),
        lineNumbers(),
        editorTheme(),
        ...(lang ? [lang] : []),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12px" },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--cm-font-family, ui-monospace, monospace)",
            lineHeight: "1.5",
          },
          ".cm-content": { padding: "6px 0" },
          ".cm-line": { padding: "0 10px" },
          ".cm-gutters": { paddingRight: "4px" },
        }),
      ],
      parent: host,
    });

    const scrollToChange = () => {
      // Prefer the first merge chunk (true changed region in the new doc).
      const chunks = getChunks(view.state)?.chunks;
      let pos: number | null = null;
      if (chunks && chunks.length > 0) {
        pos = chunks[0].fromB;
      } else if (scrollToLine != null && scrollToLine >= 1) {
        const n = Math.min(scrollToLine, view.state.doc.lines);
        pos = view.state.doc.line(n).from;
      }
      if (pos == null) return;
      const max = view.state.doc.length;
      const target = Math.min(Math.max(0, pos), max);
      view.dispatch({
        effects: EditorView.scrollIntoView(target, { y: "center" }),
      });
    };

    // Merge decorations / layout need a frame (sometimes two) before positions are stable.
    view.requestMeasure({
      read: () => null,
      write: () => {
        requestAnimationFrame(() => {
          scrollToChange();
          // Second pass after collapsed-unchanged / chunk widgets settle.
          requestAnimationFrame(scrollToChange);
        });
      },
    });

    return () => {
      view.destroy();
      host.innerHTML = "";
    };
  }, [path, oldText, newText, scrollToLine]);

  return (
    <div
      ref={hostRef}
      className={cn("h-64 min-h-[12rem] w-full overflow-hidden", className)}
    />
  );
}

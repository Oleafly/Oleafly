import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, BookMarked, Check, Maximize2, Sparkles } from "lucide-react";
import { getEditorView } from "@/components/editor/cm/controller";

interface Action {
  icon: typeof Sparkles;
  label: string;
  prompt: string;
}

const ACTIONS: Action[] = [
  { icon: ArrowLeftRight, label: "Paraphrase", prompt: "Paraphrase the following text, keeping the same meaning" },
  { icon: Sparkles, label: "Improve Writing", prompt: "Improve the clarity, tone, and flow of the following text" },
  { icon: Check, label: "Fix Grammar & Style", prompt: "Fix grammar and style issues in the following text" },
  { icon: Maximize2, label: "Expand & Elaborate", prompt: "Expand and elaborate on the following text with more detail" },
  { icon: BookMarked, label: "Find References", prompt: "Find and suggest real, verifiable citations relevant to the following text" },
];

export function SelectionActionMenu() {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = (e?: Event) => {
      const target = e?.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      const v = getEditorView();
      if (!v?.hasFocus) {
        setPos(null);
        return;
      }
      const sel = v.state.selection.main;
      if (sel.from === sel.to) {
        setPos(null);
        setExpanded(false);
        return;
      }
      const selected = v.state.sliceDoc(sel.from, sel.to);
      if (!selected.trim()) {
        setPos(null);
        return;
      }
      const coords = v.coordsAtPos(sel.head);
      if (!coords) {
        setPos(null);
        return;
      }
      setText(selected);
      setPos({ top: coords.top - 36, left: coords.left });
    };
    document.addEventListener("selectionchange", update);
    window.addEventListener("mouseup", update);
    window.addEventListener("keyup", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("mouseup", update);
      window.removeEventListener("keyup", update);
    };
  }, []);

  if (!pos) return null;

  const runAction = (action: Action) => {
    window.dispatchEvent(
      new CustomEvent("oleafly:ai-selection-action", {
        detail: { prompt: `${action.prompt}:\n\n${text}` },
      }),
    );
    setPos(null);
    setExpanded(false);
  };

  return (
    <div ref={containerRef} className="fixed z-50" style={{ top: pos.top, left: pos.left }}>
      {expanded ? (
        <div className="w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl">
          {ACTIONS.map((action) => (
            <button
              type="button"
              key={action.label}
              onClick={() => runAction(action)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <action.icon className="size-4 text-muted-foreground" />
              {action.label}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background shadow-lg"
        >
          <Sparkles className="size-3.5" />
          Ask AI
        </button>
      )}
    </div>
  );
}

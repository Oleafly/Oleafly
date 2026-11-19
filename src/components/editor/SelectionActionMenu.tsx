import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, ArrowUp, BookMarked, Check, Maximize2, MessageSquarePlus, Sparkles } from "lucide-react";
import { isImeEnter } from "@/components/ai/composer/ime";
import { requestComment, useCommentsRail } from "@/components/collab/comments-rail";
import { useCollabReady } from "@/components/collab/CollabSlots";
import { Input } from "@/components/ui/input";
import { MenuRow } from "@/components/ui/menu-row";
import { getEditorView } from "@/components/editor/cm/controller";
import { openInlineEditWithInstruction } from "@/components/editor/cm/inline-ai/openSession";
import { handoffToAssistant } from "@/features/assistant-handoff";
import { i18n } from "@/i18n";

interface Action {
  id: string;
  icon: typeof Sparkles;
  label: () => string;
  prompt: string;
}

// WebKit moves focus to the page body when a button is pressed, which would
// hide the popup before the click lands; the field and the editor keep it.
function keepFocus(event: MouseEvent) {
  event.preventDefault();
}

const ACTIONS: Action[] = [
  {
    id: "paraphrase",
    icon: ArrowLeftRight,
    label: () => i18n.t(($) => $.editor.selectionActions.paraphrase),
    prompt: "Paraphrase the following text, keeping the same meaning",
  },
  {
    id: "improve-writing",
    icon: Sparkles,
    label: () => i18n.t(($) => $.editor.selectionActions.improveWriting),
    prompt: "Improve the clarity, tone, and flow of the following text",
  },
  {
    id: "fix-grammar",
    icon: Check,
    label: () => i18n.t(($) => $.editor.selectionActions.fixGrammar),
    prompt: "Fix grammar and style issues in the following text",
  },
  {
    id: "expand",
    icon: Maximize2,
    label: () => i18n.t(($) => $.editor.selectionActions.expand),
    prompt: "Expand and elaborate on the following text with more detail",
  },
  {
    id: "find-references",
    icon: BookMarked,
    label: () => i18n.t(($) => $.editor.selectionActions.findReferences),
    prompt: "Find and suggest real, verifiable citations relevant to the following text",
  },
];

const PILL =
  "flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background shadow-lg";

const MENU_GAP = 12;

interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

interface Anchor extends Rect {
  readonly bounds: Rect;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

export function selectionMenuPosition(anchor: Anchor, size: Size): { top: number; left: number } {
  const { bounds } = anchor;
  const above = anchor.top - MENU_GAP - size.height;
  const preferred = above >= bounds.top ? above : anchor.bottom + MENU_GAP;
  return {
    top: Math.max(bounds.top, Math.min(preferred, bounds.bottom - size.height)),
    left: Math.max(bounds.left, Math.min(anchor.left, bounds.right - size.width)),
  };
}

function rectOf({ top, bottom, left, right }: Rect): Rect {
  return { top, bottom, left, right };
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

function CommentPill({ onDone }: Readonly<{ onDone: () => void }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        requestComment(getEditorView());
        onDone();
      }}
      className={PILL}
    >
      <MessageSquarePlus className="size-3.5" />
      {t(($) => $.collab.comments.add)}
    </button>
  );
}

export function SelectionActionMenu() {
  const { t } = useTranslation(["common", "editor"]);
  const collabReady = useCollabReady();
  const canCompose = useCommentsRail((state) => state.canCompose);
  const canComment = collabReady && canCompose;
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [instruction, setInstruction] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const instructionRef = useRef<HTMLInputElement>(null);
  const canCommentRef = useRef(canComment);
  canCommentRef.current = canComment;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const textRef = useRef(text);
  textRef.current = text;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    const hide = (collapse: boolean) => {
      if (anchorRef.current !== null) {
        anchorRef.current = null;
        setAnchor(null);
      }
      if (collapse && expandedRef.current) {
        expandedRef.current = false;
        setExpanded(false);
      }
    };
    const update = (e?: Event) => {
      const target = e?.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      if (containerRef.current?.contains(document.activeElement)) return;
      const v = getEditorView();
      if (!v?.hasFocus) {
        hide(false);
        return;
      }
      if (v.state.readOnly && !canCommentRef.current) {
        hide(true);
        return;
      }
      setReadOnly(v.state.readOnly);
      const sel = v.state.selection.main;
      if (sel.from === sel.to) {
        hide(true);
        return;
      }
      const selected = v.state.sliceDoc(sel.from, sel.to);
      if (!selected.trim()) {
        hide(false);
        return;
      }
      const coords = v.coordsAtPos(sel.head);
      if (!coords) {
        hide(false);
        return;
      }
      if (textRef.current !== selected) {
        textRef.current = selected;
        setText(selected);
      }
      const next = { ...rectOf(coords), bounds: rectOf(v.scrollDOM.getBoundingClientRect()) };
      const current = anchorRef.current;
      if (!current || !sameRect(current, next) || !sameRect(current.bounds, next.bounds)) {
        anchorRef.current = next;
        setAnchor(next);
      }
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

  useEffect(() => {
    if (expanded) instructionRef.current?.focus({ preventScroll: true });
  }, [expanded]);

  useLayoutEffect(() => {
    const box = containerRef.current;
    if (!box) return;
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
  });

  if (!anchor) return null;
  const pos = selectionMenuPosition(anchor, size);

  const close = () => {
    setAnchor(null);
    setExpanded(false);
    setInstruction("");
  };

  const runInstruction = (request: string) => {
    const prompt = `${request}:\n\n${text}`;
    const view = getEditorView();
    if (view?.state.readOnly) {
      close();
      return;
    }
    const inline = view ? openInlineEditWithInstruction(view, request) : false;
    if (!inline) {
      handoffToAssistant(prompt, { autoSend: true });
    }
    window.dispatchEvent(
      new CustomEvent("oleafly:ai-selection-action", {
        detail: { prompt, target: inline ? "inline" : "agent" },
      }),
    );
    close();
  };

  const runTypedInstruction = () => {
    const typed = instruction.trim();
    if (typed) runInstruction(typed);
  };

  return (
    <div ref={containerRef} className="fixed z-50" style={{ top: pos.top, left: pos.left }}>
      {expanded ? (
        <div className="w-64 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl">
          <div className="mb-1 flex items-center gap-1 p-1">
            <Input
              ref={instructionRef}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isImeEnter(event)) {
                  event.preventDefault();
                  runTypedInstruction();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setExpanded(false);
                  setInstruction("");
                  getEditorView()?.focus();
                }
              }}
              placeholder={t(($) => $.editor.selectionActions.customPrompt)}
              aria-label={t(($) => $.editor.selectionActions.customPrompt)}
              className="h-7 px-2 text-xs"
            />
            <button
              type="button"
              onClick={runTypedInstruction}
              onMouseDown={keepFocus}
              disabled={!instruction.trim()}
              aria-label={t(($) => $.editor.inlineAi.submit)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              <ArrowUp className="size-3.5" />
            </button>
          </div>
          {ACTIONS.map((action) => (
            <MenuRow
              key={action.id}
              icon={<action.icon className="size-4" />}
              label={action.label()}
              onClick={() => runInstruction(action.prompt)}
              onMouseDown={keepFocus}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {readOnly ? null : (
            <button type="button" onClick={() => setExpanded(true)} className={PILL}>
              <Sparkles className="size-3.5" />
              {t(($) => $.editor.selectionActions.askAi)}
            </button>
          )}
          {canComment ? <CommentPill onDone={close} /> : null}
        </div>
      )}
    </div>
  );
}

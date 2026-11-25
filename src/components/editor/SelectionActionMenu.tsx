import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquarePlus } from "lucide-react";
import { requestComment, useCommentsRail } from "@/components/collab/comments-rail";
import { useCollabReady } from "@/components/collab/CollabSlots";
import { placeAboveSelection, useMeasuredBox } from "@/components/ui/selection-placement";
import { getEditorView } from "@/components/editor/cm/controller";

const PILL =
  "flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background shadow-lg";

const MENU_GAP = 12;
const EMPTY_BOX = { width: 0, height: 0 };

interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

interface Anchor extends Rect {
  readonly bounds: Rect;
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
  useTranslation(["common","editor"]);
  const collabReady = useCollabReady();
  const canCompose = useCommentsRail((state) => state.canCompose);
  const canComment = collabReady && canCompose;
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [text, setText] = useState("");
  const [containerRef, box] = useMeasuredBox<HTMLDivElement>();
  const canCommentRef = useRef(canComment);
  canCommentRef.current = canComment;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const hide = () => {
      if (anchorRef.current !== null) {
        anchorRef.current = null;
        setAnchor(null);
      }
    };
    const update = (e?: Event) => {
      const target = e?.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      if (containerRef.current?.contains(document.activeElement)) return;
      const v = getEditorView();
      if (!v?.hasFocus) {
        hide();
        return;
      }
      if (v.state.readOnly && !canCommentRef.current) {
        hide();
        return;
      }
      const sel = v.state.selection.main;
      if (sel.from === sel.to) {
        hide();
        return;
      }
      const selected = v.state.sliceDoc(sel.from, sel.to);
      if (!selected.trim()) {
        hide();
        return;
      }
      const coords = v.coordsAtPos(sel.head);
      if (!coords) {
        hide();
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
  }, [containerRef]);

  if (!anchor || !canComment) return null;
  const pos = placeAboveSelection(anchor, anchor.bounds, box ?? EMPTY_BOX, MENU_GAP);

  const close = () => {
    setAnchor(null);
  };

  return (
    <div ref={containerRef} className="fixed z-50" style={{ top: pos.top, left: pos.left }}>
      <CommentPill onDone={close} />
    </div>
  );
}

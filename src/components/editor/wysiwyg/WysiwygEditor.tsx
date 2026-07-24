import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  WYSIWYG_EXTENSIONS,
  parseLatexBody,
  serializeLatexBody,
  splitLatexDocument,
  joinLatexDocument,
  parseMarkdownBody,
  serializeMarkdownBody,
  type LatexDocumentSplit,
} from "@oleafly/wysiwyg";
import { useFilesStore } from "@/store/files";
import { editorRedo, editorUndo } from "@/components/editor/cm/controller";
import { setWysiwygEditor, setWysiwygVisible } from "./controller";

function isMarkdownPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.endsWith(".md") || p.endsWith(".markdown");
}

const FLUSH_DEBOUNCE_MS = 300;

export function WysiwygEditor({ wysiwyg }: { wysiwyg: boolean }) {
  const activePath = useFilesStore((s) => s.activePath);
  const docVersion = useFilesStore((s) => s.docVersion);
  const saveFile = useFilesStore((s) => s.saveFile);
  const latexSplitRef = useRef<LatexDocumentSplit | null>(null);
  const frontmatterRef = useRef("");
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;
  const wysiwygRef = useRef(wysiwyg);
  wysiwygRef.current = wysiwyg;
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preambleRef = useRef("");
  const lastSyncedTextRef = useRef<string | null>(null);
  const [preamble, setPreamble] = useState("");
  const [hasDocumentEnv, setHasDocumentEnv] = useState(false);
  const [showPreamble, setShowPreamble] = useState(false);

  const flush = useCallback((editorInstance: Editor) => {
    const path = activePathRef.current;
    if (!path) return;
    const json = editorInstance.getJSON();
    let nextSource: string;
    if (isMarkdownPath(path)) {
      const body = serializeMarkdownBody(json);
      const frontmatter = frontmatterRef.current;
      nextSource = frontmatter ? `${frontmatter}\n\n${body}` : body;
    } else {
      const body = serializeLatexBody(json);
      const split = latexSplitRef.current;
      nextSource = split
        ? joinLatexDocument({ ...split, preamble: preambleRef.current, body })
        : body;
    }
    lastSyncedTextRef.current = nextSource;
    useFilesStore.getState().setContent(path, nextSource, { bumpVersion: true });
  }, []);

  const editor = useEditor({
    extensions: WYSIWYG_EXTENSIONS,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          editorUndo();
          return true;
        }
        if ((key === "z" && event.shiftKey) || key === "y") {
          event.preventDefault();
          editorRedo();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: editorInstance }) => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => flush(editorInstance), FLUSH_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    setWysiwygEditor(editor ?? null);
    return () => setWysiwygEditor(null);
  }, [editor]);

  useEffect(() => {
    setWysiwygVisible(wysiwyg);
  }, [wysiwyg]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: wysiwyg/docVersion are re-sync triggers, not read directly; the store is read imperatively below
  useEffect(() => {
    if (!editor || !activePath) return;
    const raw = useFilesStore.getState().files[activePath]?.content ?? "";
    if (raw === lastSyncedTextRef.current) return;
    lastSyncedTextRef.current = raw;
    if (isMarkdownPath(activePath)) {
      const { doc, frontmatter } = parseMarkdownBody(raw);
      frontmatterRef.current = frontmatter;
      latexSplitRef.current = null;
      preambleRef.current = "";
      setPreamble("");
      setHasDocumentEnv(false);
      editor.commands.setContent(doc, { emitUpdate: false });
    } else {
      const split = splitLatexDocument(raw);
      latexSplitRef.current = split;
      preambleRef.current = split.preamble;
      setPreamble(split.preamble);
      setHasDocumentEnv(split.hasDocumentEnv);
      frontmatterRef.current = "";
      editor.commands.setContent(parseLatexBody(split.body), { emitUpdate: false });
    }
  }, [editor, activePath, wysiwyg, docVersion]);

  useEffect(() => {
    if (!editor || !activePath) return;
    const path = activePath;
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (!wysiwygRef.current) return;
      activePathRef.current = path;
      flush(editor);
      void saveFile(path);
    };
  }, [editor, activePath, saveFile, flush]);

  const onPreambleChange = (value: string) => {
    setPreamble(value);
    preambleRef.current = value;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      if (editor) flush(editor);
    }, FLUSH_DEBOUNCE_MS);
  };

  return (
    <div className="wysiwyg-content flex h-full flex-col overflow-auto">
      {hasDocumentEnv && (
        <div className="mx-auto w-full max-w-[42rem] px-8 pt-6">
          <div className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => setShowPreamble((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {showPreamble ? "Hide document preamble" : "Show document preamble"}
              {showPreamble ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {showPreamble && (
              <textarea
                value={preamble}
                onChange={(e) => onPreambleChange(e.target.value)}
                spellCheck={false}
                rows={Math.min(Math.max(preamble.split("\n").length, 3), 20)}
                className="w-full resize-none border-t border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground outline-none"
              />
            )}
          </div>
        </div>
      )}
      <div className="flex-1 px-8 py-6">
        <EditorContent editor={editor} />
      </div>
      {hasDocumentEnv && (
        <div className="mx-auto w-full max-w-[42rem] px-8 pb-6">
          <div className="rounded-md border border-border px-3 py-2 text-center text-xs text-muted-foreground">
            End of document
          </div>
        </div>
      )}
    </div>
  );
}

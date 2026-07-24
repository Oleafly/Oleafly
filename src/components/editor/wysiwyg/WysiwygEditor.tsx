import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
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

function isMarkdownPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.endsWith(".md") || p.endsWith(".markdown");
}

const FLUSH_DEBOUNCE_MS = 300;

export function WysiwygEditor() {
  const activePath = useFilesStore((s) => s.activePath);
  const saveFile = useFilesStore((s) => s.saveFile);
  const latexSplitRef = useRef<LatexDocumentSplit | null>(null);
  const frontmatterRef = useRef("");
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback((editorInstance: Editor) => {
    const path = activePathRef.current;
    if (!path) return;
    const json = editorInstance.getJSON();
    if (isMarkdownPath(path)) {
      const body = serializeMarkdownBody(json);
      const frontmatter = frontmatterRef.current;
      useFilesStore.getState().setContent(path, frontmatter ? `${frontmatter}\n\n${body}` : body);
    } else {
      const body = serializeLatexBody(json);
      const split = latexSplitRef.current;
      useFilesStore.getState().setContent(path, split ? joinLatexDocument({ ...split, body }) : body);
    }
  }, []);

  const editor = useEditor({
    extensions: WYSIWYG_EXTENSIONS,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    onUpdate: ({ editor: editorInstance }) => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => flush(editorInstance), FLUSH_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    if (!editor || !activePath) return;
    const raw = useFilesStore.getState().files[activePath]?.content ?? "";
    if (isMarkdownPath(activePath)) {
      const { doc, frontmatter } = parseMarkdownBody(raw);
      frontmatterRef.current = frontmatter;
      latexSplitRef.current = null;
      editor.commands.setContent(doc, { emitUpdate: false });
    } else {
      const split = splitLatexDocument(raw);
      latexSplitRef.current = split;
      frontmatterRef.current = "";
      editor.commands.setContent(parseLatexBody(split.body), { emitUpdate: false });
    }
  }, [editor, activePath]);

  useEffect(() => {
    if (!editor || !activePath) return;
    const path = activePath;
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      activePathRef.current = path;
      flush(editor);
      void saveFile(path);
    };
  }, [editor, activePath, saveFile, flush]);

  return (
    <div className="wysiwyg-content h-full overflow-auto px-8 py-6">
      <EditorContent editor={editor} />
    </div>
  );
}

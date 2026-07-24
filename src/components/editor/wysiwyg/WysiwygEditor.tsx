import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
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

export function WysiwygEditor() {
  const activePath = useFilesStore((s) => s.activePath);
  const setContent = useFilesStore((s) => s.setContent);
  const saveFile = useFilesStore((s) => s.saveFile);
  const latexSplitRef = useRef<LatexDocumentSplit | null>(null);
  const frontmatterRef = useRef("");

  const editor = useEditor({
    extensions: WYSIWYG_EXTENSIONS,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
  });

  // Content is read imperatively, not via a reactive selector, so this effect
  // only re-runs when the active path changes - not on every store write
  // (including this component's own save-on-unmount effect below).
  useEffect(() => {
    if (!editor || !activePath) return;
    const raw = useFilesStore.getState().files[activePath]?.content ?? "";
    if (isMarkdownPath(activePath)) {
      const { doc, frontmatter } = parseMarkdownBody(raw);
      frontmatterRef.current = frontmatter;
      latexSplitRef.current = null;
      editor.commands.setContent(doc);
    } else {
      const split = splitLatexDocument(raw);
      latexSplitRef.current = split;
      frontmatterRef.current = "";
      editor.commands.setContent(parseLatexBody(split.body));
    }
  }, [editor, activePath]);

  // `path`/`markdown` are captured from this render's closure (the OLD path),
  // never read live from the store: by the time this cleanup runs on a path
  // switch, the store's activePath already holds the NEW path. React runs all
  // of a commit's effect cleanups before any of its new effect setups, so this
  // cleanup (reading editor.getJSON()) always fires before the load effect
  // above resets the editor to the new file's content.
  useEffect(() => {
    if (!editor || !activePath) return;
    const path = activePath;
    const markdown = isMarkdownPath(path);
    return () => {
      const json = editor.getJSON();
      if (markdown) {
        const body = serializeMarkdownBody(json);
        const frontmatter = frontmatterRef.current;
        setContent(path, frontmatter ? `${frontmatter}\n\n${body}` : body);
      } else {
        const body = serializeLatexBody(json);
        const split = latexSplitRef.current;
        setContent(path, split ? joinLatexDocument({ ...split, body }) : body);
      }
      void saveFile(path);
    };
  }, [editor, activePath, setContent, saveFile]);

  return <EditorContent editor={editor} />;
}

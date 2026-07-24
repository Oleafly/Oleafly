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

  return (
    <div className="wysiwyg-content h-full overflow-auto px-8 py-6">
      <EditorContent editor={editor} />
    </div>
  );
}

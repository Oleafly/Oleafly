import {
  insertTemplate,
  wrapSelectionOrPlaceholder,
} from "@/components/editor/cm/controller";
import {
  getWysiwygEditor,
  isWysiwygActive,
} from "@/components/editor/wysiwyg/controller";

/**
 * Markdown editing commands for the toolbar.
 *
 * Source mode writes Pandoc Markdown, which is what the Markdown engine
 * compiles (`--from=markdown`). Underline, highlight, superscript and
 * subscript therefore use Pandoc's own syntax rather than raw HTML: pandoc
 * drops raw HTML on the way to LaTeX, so `<u>text</u>` would vanish from the
 * PDF while `[text]{.underline}` becomes `\ul{text}`.
 *
 * Visual mode delegates to the Tiptap document for the marks its schema knows.
 * The Pandoc-only marks have no Visual equivalent and are hidden there rather
 * than inserting literal syntax into a rich-text document.
 */

export interface MarkdownHeadingLevel {
  label: string;
  hLabel: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  placeholder: string;
  className: string;
}

export const MARKDOWN_HEADING_LEVELS: MarkdownHeadingLevel[] = [
  {
    label: "Title",
    hLabel: "H1",
    level: 1,
    placeholder: "Title",
    className: "text-base font-bold",
  },
  {
    label: "Section",
    hLabel: "H2",
    level: 2,
    placeholder: "Section",
    className: "text-base font-bold",
  },
  {
    label: "Subsection",
    hLabel: "H3",
    level: 3,
    placeholder: "Subsection",
    className: "text-sm font-bold",
  },
  {
    label: "Subsubsection",
    hLabel: "H4",
    level: 4,
    placeholder: "Subsubsection",
    className: "text-sm font-semibold",
  },
  {
    label: "Minor heading",
    hLabel: "H5",
    level: 5,
    placeholder: "Minor heading",
    className: "text-xs font-semibold",
  },
  {
    label: "Paragraph heading",
    hLabel: "H6",
    level: 6,
    placeholder: "Paragraph heading",
    className: "text-xs font-medium",
  },
];

function withWysiwyg(run: (editor: NonNullable<ReturnType<typeof getWysiwygEditor>>) => void): boolean {
  if (!isWysiwygActive()) return false;
  const editor = getWysiwygEditor();
  if (!editor) return false;
  run(editor);
  return true;
}

export function insertMarkdownHeading(level: MarkdownHeadingLevel) {
  if (
    withWysiwyg((editor) =>
      editor.chain().focus().toggleHeading({ level: level.level }).run(),
    )
  ) {
    return;
  }
  wrapSelectionOrPlaceholder(
    `${"#".repeat(level.level)} `,
    "\n",
    level.placeholder,
  );
}

export function insertMarkdownBold() {
  if (withWysiwyg((editor) => editor.chain().focus().toggleBold().run())) return;
  wrapSelectionOrPlaceholder("**", "**", "text");
}

export function insertMarkdownItalic() {
  if (withWysiwyg((editor) => editor.chain().focus().toggleItalic().run())) {
    return;
  }
  wrapSelectionOrPlaceholder("*", "*", "text");
}

export function insertMarkdownStrikethrough() {
  if (withWysiwyg((editor) => editor.chain().focus().toggleStrike().run())) {
    return;
  }
  wrapSelectionOrPlaceholder("~~", "~~", "text");
}

export function insertMarkdownCode() {
  if (withWysiwyg((editor) => editor.chain().focus().toggleCode().run())) {
    return;
  }
  wrapSelectionOrPlaceholder("`", "`", "code");
}

export function insertMarkdownUnderline() {
  wrapSelectionOrPlaceholder("[", "]{.underline}", "text");
}

export function insertMarkdownHighlight() {
  wrapSelectionOrPlaceholder("[", "]{.mark}", "text");
}

export function insertMarkdownSuperscript() {
  wrapSelectionOrPlaceholder("^", "^", "text");
}

export function insertMarkdownSubscript() {
  wrapSelectionOrPlaceholder("~", "~", "text");
}

export function insertMarkdownLink() {
  const template = "[link text](url)";
  const start = template.indexOf("link text");
  insertTemplate(template, start, start + "link text".length);
}

export function insertMarkdownImage() {
  const template = "![caption](image-filename)";
  const start = template.indexOf("image-filename");
  insertTemplate(template, start, start + "image-filename".length);
}

export function insertMarkdownBlockquote() {
  if (
    withWysiwyg((editor) => editor.chain().focus().toggleBlockquote().run())
  ) {
    return;
  }
  wrapSelectionOrPlaceholder("> ", "\n", "quoted text");
}

export function insertMarkdownBulletList() {
  if (
    withWysiwyg((editor) => editor.chain().focus().toggleBulletList().run())
  ) {
    return;
  }
  wrapSelectionOrPlaceholder("- ", "\n", "Item");
}

export function insertMarkdownOrderedList() {
  if (
    withWysiwyg((editor) => editor.chain().focus().toggleOrderedList().run())
  ) {
    return;
  }
  wrapSelectionOrPlaceholder("1. ", "\n", "Item");
}

export function insertMarkdownTaskList() {
  wrapSelectionOrPlaceholder("- [ ] ", "\n", "Task");
}

export function insertMarkdownTable(rows: number, cols: number) {
  const columns = Math.max(1, cols);
  const header = `| ${Array.from({ length: columns }, (_unused, index) => `Column ${index + 1}`).join(" | ")} |`;
  const rule = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
  const body = Array.from(
    { length: Math.max(1, rows) },
    () => `| ${Array.from({ length: columns }, () => "   ").join(" | ")} |`,
  ).join("\n");
  const template = `${header}\n${rule}\n${body}\n`;
  const start = template.indexOf("Column 1");
  insertTemplate(template, start, start + "Column 1".length);
}

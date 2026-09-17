export const WYSIWYG_NODE_NAMES = {
  doc: "doc",
  paragraph: "paragraph",
  text: "text",
  heading: "heading",
  blockquote: "blockquote",
  bulletList: "bulletList",
  orderedList: "orderedList",
  listItem: "listItem",
  hardBreak: "hardBreak",
  image: "image",
  rawBlock: "rawBlock",
  rawInline: "rawInline",
  mathInline: "mathInline",
  mathDisplay: "mathDisplay",
  footnote: "footnote",
  theorem: "theorem",
  figure: "figure",
  figureCaption: "figureCaption",
  tableFloat: "tableFloat",
  tableCaption: "tableCaption",
  table: "table",
  tableRow: "tableRow",
  tableHeader: "tableHeader",
  tableCell: "tableCell",
} as const;

export const WYSIWYG_MARK_NAMES = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strike",
  code: "code",
  link: "link",
  textColor: "textColor",
  colorBox: "colorBox",
} as const;

export type WysiwygNodeName = (typeof WYSIWYG_NODE_NAMES)[keyof typeof WYSIWYG_NODE_NAMES];
export type WysiwygMarkName = (typeof WYSIWYG_MARK_NAMES)[keyof typeof WYSIWYG_MARK_NAMES];

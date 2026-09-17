// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, getSchema } from "@tiptap/core";
import { parseLatexBody } from "./latex/parse";
import { hasLatexMarkSerialization, hasLatexSerialization } from "./latex/serialize";
import { WYSIWYG_NODE_NAMES } from "./node-names";
import { createWysiwygExtensions, WYSIWYG_EXTENSIONS } from "./schema";

const FIXTURES = [
  "\\section*[S]{Energy $E=mc^2$}\nText\\footnote{n} \\textcolor{red}{x} $a$ \\[b\\] end.\n",
  "\\begin{theorem}[T]\n\\begin{itemize}\n\\item $$x$$ only\n\\end{itemize}\n\\end{theorem}\n",
  "\\begin{figure}[h]\n\\centering\n\\includegraphics[width=\\linewidth]{a}\n\\caption{C $y$}\n\\label{l}\n\\end{figure}\n",
  "\\begin{table}\n\\caption{T}\n\\begin{tabular}{|lc|}\n\\hline\na & \\multicolumn{1}{r}{$z$} \\\\\n\\hline\n\\end{tabular}\n\\end{table}\n",
  "\\begin{tabular}{l}\n\\begin{itemize}\\item x\\end{itemize} \\\\\n\\end{tabular}\n",
  "\\begin{quote}\n$$q$$\n\\end{quote}\n",
  "\\begin{align}\na\n\\end{align}\n\\begin{alignat}{1}\nb\n\\end{alignat}\n",
];

let editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe("schema", () => {
  const schema = getSchema(WYSIWYG_EXTENSIONS);

  it("declares every native LaTeX node and mark", () => {
    for (const name of Object.values(WYSIWYG_NODE_NAMES)) {
      expect(schema.nodes[name], name).toBeDefined();
    }
    expect(schema.marks.textColor).toBeDefined();
    expect(schema.marks.colorBox).toBeDefined();
  });

  it("has a LaTeX serialization branch for every node and mark in the schema", () => {
    for (const name of Object.keys(schema.nodes)) {
      expect(hasLatexSerialization(name), name).toBe(true);
    }
    for (const name of Object.keys(schema.marks)) {
      expect(hasLatexMarkSerialization(name), name).toBe(true);
    }
    expect(hasLatexSerialization("mystery")).toBe(false);
  });

  it.each(FIXTURES)("parses into a schema-valid document: %s", (source) => {
    const doc = schema.nodeFromJSON(parseLatexBody(source));
    expect(() => doc.check()).not.toThrow();
  });

  it("accepts ports through the factory while the default set keeps working", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createWysiwygExtensions({
        renderMath: () => ({ status: "ready", html: "<b>ok</b>" }),
        resolveAssetUrl: async () => null,
      }),
      content: parseLatexBody("$x$\n"),
    });
    editors.push(editor);
    expect(editor.view.dom.querySelector(".math-rendered b")).toHaveTextContent("ok");
    const plain = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: "<p>x</p>" });
    editors.push(plain);
    expect(plain.getText()).toBe("x");
  });
});

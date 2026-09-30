// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { renderMathExpression } from "@oleafly/editor/math-render";
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { afterEach, describe, expect, it } from "vitest";

// The WYSIWYG editor paints math through renderMathExpression (see
// WysiwygEditor.tsx). These cases go through that real renderer.
let editors: Editor[] = [];

function mathNode(source: string): HTMLElement {
  const display = !source.startsWith("$") || source.startsWith("$$");
  const node: JSONContent = { type: display ? "mathDisplay" : "mathInline", attrs: { source } };
  const content: JSONContent = display
    ? { type: "doc", content: [node] }
    : { type: "doc", content: [{ type: "paragraph", content: [node] }] };
  const element = document.createElement("div");
  document.body.append(element);
  editors.push(new Editor({ element, extensions: createWysiwygExtensions({ renderMath: renderMathExpression }), content }));
  const rendered = element.querySelector<HTMLElement>(".math-rendered");
  if (!rendered) throw new Error(`no math node for ${source}`);
  return rendered;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("WYSIWYG math with the app renderer", () => {
  it.each([
    ["a label with a space before its key", String.raw`$$a = b \label {eq:ab}$$`],
    ["a cleveref label", String.raw`$$a = b \label[lemma]{eq:ab}$$`],
    ["a labelled equation", String.raw`\begin{equation}a = b \label{eq:ab}\end{equation}`],
    ["a labelled multline", String.raw`\begin{multline}a + b \\ \shoveleft{+ c} \label{eq:ab} \\ = d\end{multline}`],
  ])("renders %s", (_name, source) => {
    const rendered = mathNode(source);
    expect(rendered.querySelector(".math-error")?.textContent ?? null).toBeNull();
    expect(rendered.querySelector(".katex-html")?.textContent).not.toMatch(/eq:ab|lemma/u);
  });

  it.each([
    ["inline math", String.raw`$\eqref{eq:ab}$`, "(??)"],
    ["an align row", String.raw`\begin{align}a &= b \\ c &= d \quad \text{by } \ref{eq:ab}\end{align}`, "??"],
  ])("shows a placeholder for a reference in %s", (_name, source, placeholder) => {
    const rendered = mathNode(source);
    expect(rendered.querySelector(".math-error")?.textContent ?? null).toBeNull();
    const text = rendered.querySelector(".katex-html")?.textContent;
    expect(text).toContain(placeholder);
    expect(text).not.toContain("eq:ab");
  });
});

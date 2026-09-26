// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { WYSIWYG_EXTENSIONS } from "../schema";
import { parseMarkdownBody } from "./parse";
import { serializeMarkdownBody } from "./serialize";
import { createMarkdownSourceSnapshot, markdownPreservedRanges } from "./source-layout";

const SOURCE = `# Úvod {#sec:uvod}

<!-- TODO: doplnit zdroje před odevzdáním -->

Jak uvádí [@novak2020, s. 3], papír se skládá z vrcholů[^1] <!-- ověřit -->.
Viz také @dvorak_2019 a [-@svoboda2021].

Platí 1 < 2, 5 * 3 a ~přibližně~ a <!--
víceřádkový komentář
--> konec.

* první
* druhá

| A | B |
|---|---|
| 1 | 2 |

\`\`\`
<!-- ne komentář --> [@ne]
\`\`\`

Odkaz na [manuál][man] a ![Obrázek](obr.png){width=50%}

\\newpage

[man]: https://example.com/manual

[^1]: Poznámka pod čarou.
`;

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function load(source: string) {
  const { doc, layout } = parseMarkdownBody(source);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: WYSIWYG_EXTENSIONS,
    content: doc,
  });
  editors.push(editor);
  const snapshot = createMarkdownSourceSnapshot(layout, editor.getJSON());
  expect(snapshot).not.toBeNull();
  return { editor, snapshot };
}

function topLevelPosition(editor: Editor, predicate: (text: string) => boolean): number {
  let found = -1;
  editor.state.doc.forEach((node, offset) => {
    if (found < 0 && predicate(node.textContent)) found = offset;
  });
  expect(found).toBeGreaterThanOrEqual(0);
  return found;
}

describe("Markdown source-preserving serialization", () => {
  it("writes an unedited document back byte for byte", () => {
    const { editor, snapshot } = load(SOURCE);
    expect(serializeMarkdownBody(editor.getJSON(), snapshot)).toBe(SOURCE);
  });

  it("rewrites only the edited heading", () => {
    const { editor, snapshot } = load(SOURCE);
    editor.commands.insertContentAt(2, "X");
    expect(serializeMarkdownBody(editor.getJSON(), snapshot)).toBe(
      SOURCE.replace("# Úvod {#sec:uvod}", "# ÚXvod {#sec:uvod}"),
    );
  });

  it("keeps citations, footnotes, comments and < in an edited paragraph", () => {
    const { editor, snapshot } = load(SOURCE);
    const at = topLevelPosition(editor, (text) => text.startsWith("Jak uvádí"));
    editor.commands.insertContentAt(at + 1, "Ano. ");
    const edited = SOURCE.replace(
      "Jak uvádí [@novak2020, s. 3], papír se skládá z vrcholů[^1] <!-- ověřit -->.\nViz",
      "Ano. Jak uvádí [@novak2020, s. 3], papír se skládá z vrcholů[^1] <!-- ověřit -->. Viz",
    );
    expect(serializeMarkdownBody(editor.getJSON(), snapshot)).toBe(edited);

    const next = topLevelPosition(editor, (text) => text.startsWith("Platí"));
    editor.commands.insertContentAt(next + 1, "Ano. ");
    const out = serializeMarkdownBody(editor.getJSON(), snapshot);
    expect(out).toContain("Ano. Platí 1 < 2");
    expect(out).toContain("<!--\nvíceřádkový komentář\n-->");
  });

  it("keeps reference definitions and separators when a block is deleted", () => {
    const { editor, snapshot } = load(SOURCE);
    const at = topLevelPosition(editor, (text) => text.startsWith("Jak uvádí"));
    const node = editor.state.doc.nodeAt(at);
    editor.commands.deleteRange({ from: at, to: at + (node?.nodeSize ?? 0) });
    const out = serializeMarkdownBody(editor.getJSON(), snapshot);
    expect(out).toBe(
      SOURCE.replace(
        "Jak uvádí [@novak2020, s. 3], papír se skládá z vrcholů[^1] <!-- ověřit -->.\nViz také @dvorak_2019 a [-@svoboda2021].\n\n",
        "",
      ),
    );
  });

  it("places a new block between the untouched ones", () => {
    const { editor, snapshot } = load("První odstavec.\n\n\n[x]: https://x.org\n\nDruhý [odkaz][x].\n");
    const json = editor.getJSON();
    const content: JSONContent[] = [...(json.content ?? [])];
    const inserted: JSONContent = { type: "paragraph", content: [{ type: "text", text: "Nový" }] };
    content.splice(1, 0, inserted);
    expect(serializeMarkdownBody({ ...json, content }, snapshot)).toBe(
      "První odstavec.\n\n\n[x]: https://x.org\n\nNový\n\nDruhý [odkaz][x].\n",
    );
  });

  it("keeps CRLF line endings when a block is edited or added", () => {
    const source = "# Úvod\r\n\r\nText <!-- c -->\r\nřádek\r\n\r\n- a\r\n- b\r\n";
    const { editor, snapshot } = load(source);
    expect(serializeMarkdownBody(editor.getJSON(), snapshot)).toBe(source);
    editor.commands.insertContentAt(2, "X");
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      content: [{ type: "text", text: "Nový" }],
    });
    expect(serializeMarkdownBody(editor.getJSON(), snapshot)).toBe(
      "# ÚXvod\r\n\r\nText <!-- c -->\r\nřádek\r\n\r\n- a\r\n- b\r\n\r\nNový\r\n",
    );
  });

  it("keeps untouched blocks of a long document when distant blocks are edited", () => {
    const paragraphs = Array.from({ length: 1200 }, (_, index) => `Odstavec ${index} ~ přibližně.`);
    const source = `${paragraphs.join("\n\n")}\n`;
    const { editor, snapshot } = load(source);
    const json = editor.getJSON();
    const content: JSONContent[] = [...(json.content ?? [])];
    const edited = (index: number): JSONContent => ({
      type: "paragraph",
      content: [{ type: "text", text: `Nový ${index}` }],
    });
    content[0] = edited(0);
    content[1199] = edited(1199);
    content.splice(600, 1);
    content.splice(300, 0, edited(300));
    const expected = [...paragraphs];
    expected[0] = "Nový 0";
    expected[1199] = "Nový 1199";
    expected.splice(600, 1);
    expected.splice(300, 0, "Nový 300");
    expect(serializeMarkdownBody({ ...json, content }, snapshot)).toBe(`${expected.join("\n\n")}\n`);
  });

  it("rewrites a legacy figure block as a Markdown image on the next edit", () => {
    const legacy =
      '# Title\n\n<figure data-path="figures/a b.png" data-width="0.8\\linewidth" data-type="figure">\n<div class="figure-frame" contenteditable="false"><span class="figure-path">figures/a b.png</span></div><div class="figure-caption-host"><figcaption data-type="figure-caption">Popis</figcaption></div>\n</figure>\n';
    const { editor, snapshot } = load(legacy);
    editor.commands.insertContentAt(2, "X");
    expect(serializeMarkdownBody(editor.getJSON(), snapshot)).toBe(
      "# TXitle\n\n![Popis](<figures/a b.png>)\n",
    );
  });

  it("protects comments and footnote markers outside code only", () => {
    const source = "Text `<!-- a --> [^a]` a <!-- b -->[^n]\n\n```\n<!-- c --> [^x]\n```\n";
    expect(
      markdownPreservedRanges(source).map(({ from, to }) => source.slice(from, to)),
    ).toEqual(["<!-- b -->", "[^n]"]);
    const { doc } = parseMarkdownBody(source);
    const raw: string[] = [];
    const visit = (node: JSONContent) => {
      if (node.type === "rawInline") raw.push(String(node.attrs?.source));
      node.content?.forEach(visit);
    };
    visit(doc);
    expect(raw).toEqual(["<!-- b -->", "[^n]"]);
  });
});

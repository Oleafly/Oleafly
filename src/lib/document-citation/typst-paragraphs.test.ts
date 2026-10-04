import { describe, expect, it } from "vitest";
import {
  detectScanFormat,
  extractTypstKeywords,
  hayagrivaIdentityText,
  splitTypstParagraphs,
} from "./typst-paragraphs";
import { parseBibliographyIdentities } from "./bibliography-filter";

const DOCUMENT = `#import "lib.typ": chart
#set document(title: "Graphs", author: "A. Author")
#set page(
  paper: "a4",
  header: context {
    if counter(page).get().first() > 1 [Running head text that is long enough]
  },
)
#show heading.where(level: 1): it => block(above: 16pt, it)
#show: doc => conf(
  title: [A long title that should never be scanned as prose],
  doc,
)
#let note(body) = {
  set text(size: 9pt)
  block(inset: 4pt, body)
}

// A comment line with plenty of words that must not become a paragraph at all.
/* A block comment
   spanning lines with more than enough words to pass the length filter. */

= Introduction <sec:intro>

Graph neural networks are used for molecule generation in this work @kipf2017.
The method extends prior message-passing approaches with a novel decoder // trailing note
and keeps links like https://example.org/path intact.

== Method

#figure(
  image("figs/plot.png", width: 80%),
  caption: [A caption with enough words to look like a paragraph to a naive splitter],
) <fig:plot>

\`\`\`python
print("code that is long enough to pass the minimum length filter easily")
\`\`\`

We train with $cal(L) = sum_i x_i^2$ and *strong* markup, see @fig:plot and #cite(<vaswani2017>).

#bibliography("refs.bib", style: "ieee")
`;

describe("splitTypstParagraphs", () => {
  it("keeps prose and skips set, show, let, import, code, comments, and headings", () => {
    const paragraphs = splitTypstParagraphs(DOCUMENT);
    expect(paragraphs.map((paragraph) => paragraph.index)).toEqual([0, 1]);
    expect(paragraphs[0].text).toMatch(/^Graph neural networks/);
    expect(paragraphs[0].text).toContain("https://example.org/path");
    expect(paragraphs[0].text).not.toContain("trailing note");
    expect(paragraphs[1].text).toMatch(/^We train with/);
    const joined = paragraphs.map((paragraph) => paragraph.text).join("\n");
    for (const hidden of [
      "Running head",
      "long title",
      "comment line",
      "block comment",
      "Introduction",
      "caption with enough words",
      "print(",
      "bibliography",
      "set text",
    ]) {
      expect(joined).not.toContain(hidden);
    }
  });

  it("caps at maxParagraphs and respects the minimum length", () => {
    const body = Array.from({ length: 30 }, (_, index) =>
      `This is paragraph number ${index} with enough prose to pass the minimum length filter.`,
    ).join("\n\n");
    expect(splitTypstParagraphs(body, { maxParagraphs: 4 })).toHaveLength(4);
    expect(splitTypstParagraphs("Too short.\n\nAlso short.")).toEqual([]);
  });

  it("keeps the content of markup functions inside a paragraph", () => {
    const [paragraph] = splitTypstParagraphs(
      "#emph[Diffusion models] generate images from noise, as #link(\"https://x.org\")[recent work] shows in detail.",
    );
    expect(paragraph.text).toContain("#emph[Diffusion models]");
  });
});

describe("extractTypstKeywords", () => {
  it("drops citations, references, labels, math, raw text, and markup", () => {
    const query = extractTypstKeywords(
      "We train with $cal(L) = sum_i x_i^2$ and *strong* _emph_ markup, see @fig:plot and #cite(<vaswani2017>) <label> `raw code` #emph[graph networks] #link(\"https://x.org\")[linked text].",
    );
    expect(query).toBe("We train with and strong emph markup, see and graph networks linked text.");
  });

  it("reduces long prose to the first content words", () => {
    const long = `${"Graph neural networks learn molecular structure from data. ".repeat(6)}`;
    const query = extractTypstKeywords(long, 5);
    expect(query).toBe("Graph neural networks learn molecular");
  });

  it("strips heading and list markers that follow blank or indented lines", () => {
    expect(extractTypstKeywords("Intro words here\n\n\n  = Heading text\n\t- first item\n+ second item\n/ Term: body")).toBe(
      "Intro words here Heading text first item second item Term: body",
    );
    expect(extractTypstKeywords("Keep x-y and a+b and ==no space marker here")).toBe(
      "Keep x-y and a+b and ==no space marker here",
    );
  });

  it("closes the space before punctuation however wide it is", () => {
    expect(extractTypstKeywords("Words before   , a comma \n\n . and a stop ; done")).toBe(
      "Words before, a comma. and a stop; done",
    );
    expect(extractTypstKeywords("  ! starts with punctuation then words")).toBe("! starts with punctuation then words");
  });

  it("returns nothing for markup-only text", () => {
    expect(extractTypstKeywords("@a @b $x$ <l>")).toBe("");
  });
});

describe("detectScanFormat", () => {
  it("uses the file extension and sniffs selections without one", () => {
    expect(detectScanFormat("chapters/intro.typ", "")).toBe("typst");
    expect(detectScanFormat("main.tex", "#set page()")).toBe("latex");
    expect(detectScanFormat("selection", "#set text(size: 10pt)\nBody text.")).toBe("typst");
    expect(detectScanFormat("selection", "= Heading\n\nSome prose.")).toBe("typst");
    expect(detectScanFormat("selection", "\\section{Intro} Some prose.")).toBe("latex");
    expect(detectScanFormat(null, "Plain words only.")).toBe("latex");
  });

  it("finds Typst statements and headings on any line after leading space", () => {
    expect(detectScanFormat(null, "Prose first.\n\n   \n\t#let x = 1")).toBe("typst");
    expect(detectScanFormat(null, "Prose first.\n  ==  Heading")).toBe("typst");
    expect(detectScanFormat(null, "Prose\n=\n\nHeading below a bare marker")).toBe("typst");
    expect(detectScanFormat(null, "Prose then #set inline only")).toBe("latex");
    expect(detectScanFormat(null, "Prose\n#settings are not statements\n=")).toBe("latex");
  });
});

describe("splitTypstParagraphs statements", () => {
  it("skips a statement up to the end of its line or its closing bracket", () => {
    const text = [
      "#set text(font: \"A\\\"B)\", size: 9pt) // tail",
      "#show heading: it => [Content with ( and { that never closes]",
      "#let f(x) = `raw ) still raw`",
      "#import \"a.typ\": (",
      "  b,",
      "  c,",
      ")",
      "Prose that should remain after the statements above.",
    ].join("\n");
    expect(splitTypstParagraphs(text, { minLength: 1 }).map((paragraph) => paragraph.text)).toEqual([
      "Prose that should remain after the statements above.",
    ]);
  });

  it("keeps escaped hashes and statements that are not at a line start", () => {
    expect(splitTypstParagraphs("Text with \\#set inside and #set after words.", { minLength: 1 })).toEqual([
      { index: 0, text: "Text with \\#set inside and #set after words." },
    ]);
  });
});

describe("hayagrivaIdentityText", () => {
  it("lets Hayagriva entries filter already-cited papers", () => {
    const yaml = `kipf2017:
  type: article
  title: Semi-Supervised Classification with Graph Convolutional Networks
  serial-number:
    doi: 10.1/gcn
`;
    const identities = parseBibliographyIdentities(hayagrivaIdentityText(yaml));
    expect(identities.dois.has("10.1/gcn")).toBe(true);
    expect([...identities.titles][0]).toMatch(/^semisupervisedclassification/);
    expect(hayagrivaIdentityText("name: ci\non: push\n")).toBe("");
  });
});

describe("splitTypstParagraphs unterminated syntax", () => {
  const paragraphs = (text: string) => splitTypstParagraphs(text, { minLength: 1 }).map((paragraph) => paragraph.text);

  it("drops nested and unterminated block comments", () => {
    expect(paragraphs("Kept prose.\n\n/* outer /* inner */ still comment */ After.\n\n/* never closed\nHidden prose.")).toEqual([
      "Kept prose.",
      "After.",
    ]);
  });

  it("drops a statement whose bracket never closes", () => {
    expect(paragraphs("Kept prose.\n\n#set text(\n  lang: \"en\",\nHidden prose.")).toEqual(["Kept prose."]);
  });

  it("drops an unclosed code fence to the end", () => {
    expect(paragraphs("Kept prose.\n\n```python\nprint('hidden')")).toEqual(["Kept prose."]);
  });

  it("reads empty raw spans and escapes inside a statement", () => {
    expect(paragraphs("#let x = [a \\] b ``] still statement]\nProse after the statement.")).toEqual([
      "Prose after the statement.",
    ]);
  });

  it("keeps a line that starts with a hash but names no statement", () => {
    expect(paragraphs("#(1 + 2) apples were counted in this sentence.")).toEqual([
      "#(1 + 2) apples were counted in this sentence.",
    ]);
  });
});

describe("hayagrivaIdentityText without titles", () => {
  it("writes only the DOI for an entry without a title", () => {
    expect(hayagrivaIdentityText("harry:\n  type: book\n  doi: 10.1/x\n")).toBe("@misc{harry,\n  doi = {10.1/x}\n}");
  });
});

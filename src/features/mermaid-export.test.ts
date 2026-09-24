// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  MERMAID_EXPORT_DIRECTIVE,
  mermaidExportSource,
  mermaidRasterScale,
  standaloneMermaidSvg,
} from "./mermaid-export";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARKUP = /<\/?[a-z][^<>]*>|&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;

function htmlParsedSvg(markup: string): Element {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const svg = parsed.body.firstElementChild;
  if (svg?.namespaceURI !== SVG_NS) throw new Error("fixture is not an SVG");
  return svg;
}

function parseXml(svg: string): Document {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(parsed.querySelector("parsererror")).toBeNull();
  expect(parsed.documentElement.localName).toBe("svg");
  return parsed;
}

function rows(text: Element): Element[] {
  return Array.from(text.children).filter((child) => child.localName === "tspan");
}

function lines(text: Element): string[] {
  return rows(text).map((row) => row.textContent ?? "");
}

function runs(row: Element): string[][] {
  return Array.from(row.children).map((run) => [
    run.textContent ?? "",
    run.getAttribute("font-weight") ?? "",
    run.getAttribute("font-style") ?? "",
    run.getAttribute("baseline-shift") ?? "",
  ]);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formattedLabel(wordLines: string[][]): string {
  const outers = wordLines.map((words, index) => {
    const inner = words
      .map(
        (word, position) =>
          `<tspan font-style="normal" class="text-inner-tspan" font-weight="normal">${escapeHtml(position > 0 ? ` ${word}` : word)}</tspan>`,
      )
      .join("");
    const y = Math.round((index * 1.1 - 0.1) * 10) / 10;
    return `<tspan class="text-outer-tspan row" x="0" y="${y}em" dy="1.1em">${inner}</tspan>`;
  });
  return `<text y="-10.1" style="">${outers.join("")}</text>`;
}

function exportedLabel(wordLines: string[][], source = ""): Element {
  const diagram = htmlParsedSvg(
    `<svg xmlns="${SVG_NS}" viewBox="0 0 300 120"><g class="node default"><g class="label">${formattedLabel(wordLines)}</g></g></svg>`,
  );
  const text = parseXml(standaloneMermaidSvg(diagram, source).svg).getElementsByTagNameNS(SVG_NS, "text")[0];
  expect(text).toBeDefined();
  return text;
}

describe("mermaidExportSource", () => {
  it("puts the export directive last so it overrides the author's front matter and directives", () => {
    const source = [
      "---",
      "config:",
      "  htmlLabels: true",
      "---",
      '%%{init: {"htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%',
      "flowchart TD",
      "  A --> B",
      "",
    ].join("\n");
    const exported = mermaidExportSource(source);
    expect(exported).toBe(`${source.trimEnd()}${MERMAID_EXPORT_DIRECTIVE}`);
    const body = /^%%\{init:\s*(.*)\}%%$/.exec(MERMAID_EXPORT_DIRECTIVE)?.[1];
    expect(JSON.parse(body ?? "null")).toEqual({ htmlLabels: false, flowchart: { htmlLabels: false } });
  });

  it("adds nothing but the directive, so a source at the 50,000-character limit stays within Mermaid's limit", () => {
    const tail = '\n  "A" : 1\n  "B" : 2';
    const source = `pie title ${"t".repeat(50_000 - "pie title ".length - tail.length)}${tail}`;
    expect(source).toHaveLength(50_000);
    expect(mermaidExportSource(source).replace(MERMAID_EXPORT_DIRECTIVE, "")).toBe(source);
  });
});

describe("standaloneMermaidSvg", () => {
  it("turns HTML labels into well-formed SVG text and sizes the image from the view box", () => {
    const diagram = htmlParsedSvg(
      '<svg id="m1" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 240px; background-color: white;" viewBox="0 0 240 120">' +
        '<g class="label" transform="translate(-40, -24)"><foreignObject width="80" height="48">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="display: table-cell; white-space: nowrap;">' +
        '<span class="nodeLabel" style="color: #ff0000 !important"><p>Line one<br>line&nbsp;two &amp; more</p></span>' +
        "</div></foreignObject></g></svg>",
    );

    const { svg, width, height } = standaloneMermaidSvg(diagram);
    const root = parseXml(svg).documentElement;

    expect({ width, height }).toEqual({ width: 240, height: 120 });
    expect(root.getAttribute("width")).toBe("240");
    expect(root.getAttribute("height")).toBe("120");
    expect(root.getAttribute("style")).toBe("background-color: white");
    expect(root.getElementsByTagNameNS(SVG_NS, "foreignObject")).toHaveLength(0);
    const texts = root.getElementsByTagNameNS(SVG_NS, "text");
    expect(texts).toHaveLength(1);
    expect(lines(texts[0])).toEqual(["Line one", "line\u00a0two & more"]);
    expect(texts[0].getAttribute("style")).toBe("fill: #ff0000");
    expect(rows(texts[0]).map((row) => [row.getAttribute("x"), row.getAttribute("y")])).toEqual([
      ["40", "12"],
      ["40", "36"],
    ]);
    expect(diagram.getElementsByTagNameNS(SVG_NS, "foreignObject")).toHaveLength(1);
    expect(diagram.getAttribute("width")).toBe("100%");
    expect(document.body.childElementCount).toBe(0);
  });

  it("keeps bold, italic and subscript formatting from a foreignObject label", () => {
    const diagram = htmlParsedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><g class="label"><foreignObject width="200" height="24">' +
        '<div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p><b>Water</b> is <i>H<sub>2</sub>O</i></p></span></div>' +
        "</foreignObject></g></svg>",
    );

    const text = parseXml(standaloneMermaidSvg(diagram).svg).getElementsByTagNameNS(SVG_NS, "text")[0];

    expect(lines(text)).toEqual(["Water is H2O"]);
    expect(runs(rows(text)[0])).toEqual([
      ["Water", "bold", "", ""],
      [" is ", "", "", ""],
      ["H", "", "italic", ""],
      ["2", "", "italic", "sub"],
      ["O", "", "italic", ""],
    ]);
  });

  it("replaces a foreignObject switch with one text label and drops empty labels", () => {
    const diagram = htmlParsedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 120"><g><rect x="150" y="50" width="350" height="50"></rect>' +
        '<switch><foreignObject x="150" y="50" width="350" height="50">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" class="journey-section section-type-0"><div class="label">Go to work</div></div>' +
        '</foreignObject><text x="325" y="75" class="journey-section section-type-0"><tspan x="325">Go to work</tspan></text></switch></g>' +
        '<g class="edgeLabel"><foreignObject width="0" height="0"><div xmlns="http://www.w3.org/1999/xhtml"><span class="edgeLabel"></span></div></foreignObject></g>' +
        "</svg>",
    );

    const root = parseXml(standaloneMermaidSvg(diagram).svg).documentElement;

    expect(root.getElementsByTagNameNS(SVG_NS, "switch")).toHaveLength(0);
    expect(root.getElementsByTagNameNS(SVG_NS, "foreignObject")).toHaveLength(0);
    const texts = Array.from(root.getElementsByTagNameNS(SVG_NS, "text"));
    expect(texts).toHaveLength(1);
    expect(texts[0].hasAttribute("class")).toBe(false);
    expect(lines(texts[0])).toEqual(["Go to work"]);
    const row = rows(texts[0])[0];
    expect([row.getAttribute("x"), row.getAttribute("y")]).toEqual(["325", "75"]);
  });

  it("renders inline HTML tags in an SVG text label as formatting instead of literal tags", () => {
    const text = exportedLabel(
      [["<b>", "Bold", "</b>", "and", "<i>", "italic"], ["</i>"]],
      'flowchart TD\n  A["<b>Bold</b> and <i>italic</i>"]',
    );

    expect(text.textContent).not.toMatch(MARKUP);
    expect(lines(text)).toEqual(["Bold and italic"]);
    expect(runs(rows(text)[0])).toEqual([
      ["Bold", "bold", "normal", ""],
      [" and ", "normal", "normal", ""],
      ["italic", "normal", "italic", ""],
    ]);
    expect(rows(text)[0].getAttribute("class")).toBe("text-outer-tspan row");
    expect(rows(text)[0].getAttribute("y")).toBe("0.45em");
  });

  it("attaches subscripts and superscripts to their word using the spacing in the source", () => {
    const text = exportedLabel(
      [["H", "<sub>", "2", "</sub>", "O", "and", "y"], ["<sup>", "2", "</sup>"]],
      'flowchart TD\n  A["H<sub>2</sub>O and y<sup>2</sup>"]',
    );

    expect(lines(text)).toEqual(["H2O and y2"]);
    expect(runs(rows(text)[0])).toEqual([
      ["H", "normal", "normal", ""],
      ["2", "normal", "normal", "sub"],
      ["O and y", "normal", "normal", ""],
      ["2", "normal", "normal", "super"],
    ]);
    const shifted = Array.from(rows(text)[0].children).filter((run) => run.hasAttribute("baseline-shift"));
    expect(shifted.map((run) => run.getAttribute("font-size"))).toEqual(["75%", "75%"]);
  });

  it("guesses the spacing around tags when the label is not in the source", () => {
    const text = exportedLabel([["H", "<sub>", "2", "</sub>", "O", "and", "(", "<i>", "n", "</i>", ")"]]);

    expect(lines(text)).toEqual(["H2 O and (n)"]);
    expect(text.textContent).not.toMatch(MARKUP);
  });

  it("decodes entity codes the way the on-screen label shows them", () => {
    const text = exportedLabel(
      [["quote", "&quot;hi&quot;", "and"], ["done&nbsp;now", "&#35;1", "Tom", "&", "Jerry"]],
      'flowchart TD\n  B["quote #quot;hi#quot; and done&nbsp;now #35;1 Tom &amp; Jerry"]',
    );

    expect(lines(text)).toEqual(['quote "hi" and', "done\u00a0now #1 Tom & Jerry"]);
    expect(text.textContent).not.toMatch(MARKUP);
  });

  it("rejoins a tag or entity code that Mermaid split across wrapped lines", () => {
    const text = exportedLabel(
      [['<span style="col'], ['or:red">', "Red", "</span>", "text", '"quoted&'], ["quot;", "&"], ["ampersand"]],
      `flowchart TD\n  A["<span style='color:red'>Red</span> text #quot;quoted#quot; &amp; ampersand"]`,
    );

    expect(text.textContent).not.toMatch(MARKUP);
    expect(lines(text)).toEqual(['Red text "quoted"', "&", "ampersand"]);
    expect(Array.from(rows(text)[0].children)[0].getAttribute("style")).toBe("fill: red");
  });

  it("drops an image tag the way the sanitized on-screen label shows no text for it", () => {
    const text = exportedLabel([['<img src="x">', "label", "<a href='#a'>", "link", "</a>"]]);

    expect(lines(text)).toEqual(["label link"]);
  });

  it("leaves labels without inline HTML or entity codes untouched", () => {
    const wordLines = [["+List<int>", "items"], ["a", "<", "b", "R&D"]];
    const text = exportedLabel(wordLines, "classDiagram\n  class Box~T~");

    expect(rows(text).map((row) => Array.from(row.children).map((run) => run.textContent))).toEqual([
      ["+List<int>", " items"],
      ["a", " <", " b", " R&D"],
    ]);
    expect(rows(text).map((row) => row.getAttribute("y"))).toEqual(["-0.1em", "1em"]);
  });

  it("centers mindmap labels that Mermaid leaves at the node origin", () => {
    const diagram = htmlParsedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">' +
        '<g class="node mindmap-node section-root"><circle r="32"></circle>' +
        '<g class="label" transform="translate(0, -9.5)"><text y="-10.1"><tspan x="0">Thesis</tspan></text></g></g>' +
        '<g class="node mindmap-node section-0"><path d="M0 0"></path>' +
        '<g class="label" transform="translate(-41.3, -9.5)"><text y="-10.1"><tspan x="0">Background</tspan></text></g></g>' +
        '<g class="node default"><g class="label" transform="translate(0, -9.5)"><text><tspan>Flow</tspan></text></g></g>' +
        "</svg>",
    );

    const texts = Array.from(parseXml(standaloneMermaidSvg(diagram).svg).getElementsByTagNameNS(SVG_NS, "text"));

    expect(texts.map((text) => text.getAttribute("text-anchor"))).toEqual(["middle", null, null]);
  });

  it("falls back to absolute width and height attributes when there is no view box", () => {
    const sized = standaloneMermaidSvg(
      htmlParsedSvg('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="10" height="10"></rect></svg>'),
    );
    expect([sized.width, sized.height]).toEqual([300, 150]);

    const fluid = standaloneMermaidSvg(
      htmlParsedSvg('<svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 300px;"><rect></rect></svg>'),
    );
    expect([fluid.width, fluid.height]).toEqual([0, 0]);
    expect(parseXml(fluid.svg).documentElement.getAttribute("style")).toBe("max-width: 300px;");
  });
});

describe("mermaidRasterScale", () => {
  it("renders at least 2000 pixels on the longer side unless the canvas would get too large", () => {
    expect(mermaidRasterScale(400, 300)).toBe(5);
    expect(mermaidRasterScale(89, 72) * 89).toBeCloseTo(2000);
    expect(mermaidRasterScale(134, 448) * 448).toBeCloseTo(2000);
    expect(mermaidRasterScale(1400, 900)).toBe(2);
    expect(mermaidRasterScale(0, 0)).toBe(2);
    expect(mermaidRasterScale(6000, 1000)).toBeCloseTo(8192 / 6000);
    expect(mermaidRasterScale(4000, 4000)).toBeCloseTo(1.024);
    const scale = mermaidRasterScale(3000, 2500);
    expect(3000 * scale * 2500 * scale).toBeCloseTo(4096 * 4096, 0);
  });
});

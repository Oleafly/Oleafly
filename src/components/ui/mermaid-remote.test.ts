// @vitest-environment jsdom

import DOMPurify from "dompurify";
import { describe, expect, it } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import {
  isMermaidRemoteContentError,
  MERMAID_LABEL_PURIFY,
  MermaidRemoteContentError,
  secureDrawing,
  sourceLoadsRemoteContent,
} from "./mermaid-remote";

const HOST = "attacker.example";

const REMOTE_DIAGRAMS: readonly (readonly [string, string])[] = [
  ["an image shape", `flowchart LR\n  A@{ img: "https://${HOST}/p.png?u=1" }`],
  ["an image shape with a plain value", `flowchart LR\n  A@{ shape: image, img: https://${HOST}/p.png, w: 40 }`],
  ["an image shape without slashes", `flowchart LR\n  A@{ img: 'https:${HOST}/p.png' }`],
  ["an image shape on a protocol-relative URL", `flowchart LR\n  A@{ img: "//${HOST}/p.png" }`],
  ["an image shape with YAML escapes", `flowchart LR\n  A@{ "i\\x6dg": "\\x68ttps://${HOST}/p.png" }`],
  ["an image shape split by an escaped line break", `flowchart LR\n  A@{ img: "https:\\\n    //${HOST}/p.png" }`],
  ["an image shape behind an alias", `flowchart LR\n  A@{ x: &u "https://${HOST}/p.png", img: *u }`],
  ["an image shape in a block scalar", `flowchart LR\n  A@{\n    img: |\n      https://${HOST}/p.png\n  }`],
  ["an image shape in a list", `flowchart LR\n  A@{ img: ["https://${HOST}/p.png"] }`],
  ["themeCSS in an init directive", `%%{init: {"themeCSS": ".node rect { fill: url(https://${HOST}/t.png) }"}}%%\nflowchart LR\n  A --> B`],
  ["themeCSS with a JSON escape", `%%{init: {"themeCSS": ".node rect { fill: \\u0075rl(https://${HOST}/t.png) }"}}%%\nflowchart LR\n  A --> B`],
  ["themeCSS in front matter", `---\nconfig:\n  themeCSS: |\n    .label { background: URL("https://${HOST}/t.png") }\n---\nflowchart LR\n  A --> B`],
  ["themeCSS with @import", `%%{init: {"themeCSS": "@import 'https://${HOST}/s.css';"}}%%\nflowchart LR\n  A --> B`],
  ["a font family that injects CSS", `%%{init: {"fontFamily": "x; background: url(https://${HOST}/f.png)"}}%%\nflowchart LR\n  A --> B`],
  ["a classDef", `flowchart LR\n  A --> B\n  classDef bad fill:url(https://${HOST}/c.png)\n  class A bad`],
  ["a style statement", `flowchart LR\n  A --> B\n  style A background-image:url('//${HOST}/s.png')`],
  ["a linkStyle", `flowchart LR\n  A --> B\n  linkStyle 0 stroke:url(https://${HOST}/l.svg#p)`],
  ["a style with a mermaid entity", `flowchart LR\n  A --> B\n  style A background:u#114;l(https://${HOST}/e.png)`],
  ["a style with a CSS escape", `flowchart LR\n  A --> B\n  style A background:u\\72 l(https://${HOST}/e.png)`],
  ["image-set", `flowchart LR\n  A --> B\n  style A background:image-set("https://${HOST}/i.png" 1x)`],
  ["an HTML label image", `flowchart LR\n  A["<img src='https://${HOST}/h.png' width='40'>"]`],
  ["an HTML label srcset", `flowchart LR\n  A["<img srcset='a.png 1x, https://${HOST}/h.png 2x'>"]`],
  ["an HTML label with an encoded source", `flowchart LR\n  A["<img src=&#104;ttps://${HOST}/h.png>"]`],
  ["an HTML label style attribute", `flowchart LR\n  A["<span style='background:url(https://${HOST}/h.png)'>x</span>"]`],
  ["an SVG image in a label", `flowchart LR\n  A["<svg><image href='https://${HOST}/h.png'/></svg>"]`],
  ["a video poster", `flowchart LR\n  A["<video poster='https://${HOST}/v.png'></video>"]`],
  ["a sequence actor icon", `sequenceDiagram\n  participant A\n  properties A: {"icon": "https://${HOST}/i.png"}\n  A->>A: hi`],
  ["sequence actor details read from the page", `sequenceDiagram\n  participant A\n  details A: note-heading\n  A->>A: hi`],
];

const ORDINARY_DIAGRAMS: readonly (readonly [string, string])[] = [
  ["a plain flowchart", "flowchart TD\n  A[Start] --> B{Is it?}\n  B -->|Yes| C[OK]\n  B -->|No| D[End]"],
  [
    "styles and classes",
    "flowchart LR\n  A --> B\n  classDef hot fill:#f96,stroke:#333,stroke-width:4px;\n  class A hot\n  style B fill:#bbf,color:#fff\n  linkStyle 0 stroke:#ff3,stroke-width:4px",
  ],
  ["a link on a node", 'flowchart LR\n  A --> B\n  click A href "https://example.com/docs" "Open docs"'],
  ["labels that mention URLs", 'flowchart LR\n  A["See https://example.com"] --> B["fetch(url) and curl(https://example.com)"]'],
  ["an embedded image", 'flowchart LR\n  A@{ img: "data:image/png;base64,iVBORw0KGgo=", label: "Logo", w: 40, h: 40 }'],
  ["an app image", 'flowchart LR\n  A@{ img: "/assets/logo.png", label: "Logo" }'],
  ["an icon", 'flowchart LR\n  A@{ icon: "fa:user", form: "square", label: "User" }'],
  ["a theme directive", "%%{init: {\"theme\": \"forest\", \"themeVariables\": {\"primaryColor\": \"#ffcc00\"}}}%%\nflowchart LR\n  A --> B"],
  ["a fragment fill", "flowchart LR\n  A --> B\n  style A fill:url(#shade)"],
  ["entities in labels", 'flowchart LR\n  A["A #quot;quoted#quot; word #9829;"] --> B'],
  ["an HTML label", 'flowchart LR\n  A["<b>Bold</b><br/><span style=\'color:red\'>red</span>"]'],
  ["a sequence diagram with links", 'sequenceDiagram\n  participant A\n  link A: Docs @ https://example.com/docs\n  A->>B: Hello'],
  ["a gantt chart with a link", "gantt\n  title Plan\n  section A\n  Task :a1, 2024-01-01, 3d\n  click a1 href \"https://example.com\""],
  ["a mindmap with icons", "mindmap\n  root((Topic))\n    Child\n    ::icon(fa fa-book)"],
];

function drawing(markup: string): Element {
  const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, "text/html");
  const svg = parsed.body.firstElementChild;
  if (!svg) throw new Error("no svg");
  return svg;
}

describe("sourceLoadsRemoteContent", () => {
  it.each(REMOTE_DIAGRAMS)("finds %s", (_name, source) => {
    expect(sourceLoadsRemoteContent(source)).toBe(true);
  });

  it.each(ORDINARY_DIAGRAMS)("leaves %s alone", (_name, source) => {
    expect(sourceLoadsRemoteContent(source)).toBe(false);
  });

  it("scans a large hostile source in linear time", () => {
    const hostile = [
      `sequenceDiagram\n${"\n".repeat(100_000)}`,
      `sequenceDiagram\ndetails ${" ".repeat(100_000)}`,
      "url(".repeat(10_000),
      `<use ${" ".repeat(40_000)}`,
      `A@{ img: ${" ".repeat(40_000)}`,
    ];
    const started = performance.now();
    for (const source of hostile) sourceLoadsRemoteContent(source);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("secureDrawing", () => {
  it("turns outside links into plain text and keeps links inside the drawing", () => {
    const svg = drawing(
      '<a xlink:href="https://example.com/x" target="_blank"><text>A</text></a><a href="javascript:alert(1)"><text>B</text></a><a href="#node-c"><text>C</text></a>',
    );
    secureDrawing(svg);
    const links = [...svg.querySelectorAll("a")];
    expect(links.map((link) => link.getAttributeNames())).toEqual([[], [], ["href"]]);
    expect(links[2]?.getAttribute("href")).toBe("#node-c");
    expect(svg.textContent).toBe("ABC");
  });

  it("keeps the parts of an ordinary drawing", () => {
    const svg = drawing(
      '<style>#m .node rect{fill:#fff;filter:url(#drop-shadow)}</style><path marker-end="url(#arrowhead)" d="M0 0L10 10"/><image href="data:image/png;base64,iVBORw0KGgo=" width="10"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="display:table-cell">Label</div></foreignObject>',
    );
    expect(() => secureDrawing(svg)).not.toThrow();
    expect(svg.querySelector("image")?.getAttribute("href")).toMatch(/^data:/);
  });

  it.each([
    ["an image", `<image href="https://${HOST}/i.png"/>`],
    ["an xlink image", `<image xlink:href="//${HOST}/i.png"/>`],
    ["a style sheet", `<style>.node{background:url("https://${HOST}/s.png")}</style>`],
    ["an escaped style sheet", `<style>.node{background:u\\72 l(https://${HOST}/s.png)}</style>`],
    ["a style attribute", `<g style="background-image:url(https://${HOST}/s.png)"></g>`],
    ["a paint reference", `<rect fill="url(https://${HOST}/p.svg#g)"/>`],
    ["an HTML image", `<foreignObject><img xmlns="http://www.w3.org/1999/xhtml" src="https://${HOST}/i.png"/></foreignObject>`],
    ["a srcset", `<foreignObject><img xmlns="http://www.w3.org/1999/xhtml" srcset="a.png 1x, https://${HOST}/i.png 2x"/></foreignObject>`],
  ])("refuses %s from the internet", (_name, markup) => {
    expect(() => secureDrawing(drawing(markup))).toThrow(MermaidRemoteContentError);
  });
});

describe("the label sanitizer settings", () => {
  it("drop sources, links and style sheets from labels but keep inline styles", () => {
    const clean = DOMPurify.sanitize(
      `<img src="https://${HOST}/i.png"><img src="data:image/png;base64,iVBORw0KGgo="><a href="https://example.com">link</a><span style="color:red">red</span><style>*{background:url(https://${HOST}/s.png)}</style><svg><image href="https://${HOST}/s.png"></image></svg>`,
      MERMAID_LABEL_PURIFY,
    );
    expect(clean).not.toContain(HOST);
    expect(clean).not.toContain("src=");
    expect(clean).not.toContain("href=");
    expect(clean).not.toContain("<style");
    expect(clean).toContain('<span style="color:red">red</span>');
    expect(clean).toContain(">link</a>");
  });

  it("names its error so callers can tell it from a parse error", () => {
    expect(new MermaidRemoteContentError().message).toBe(enCore.mermaid.remoteBlocked);
    expect(isMermaidRemoteContentError(new MermaidRemoteContentError())).toBe(true);
    expect(isMermaidRemoteContentError(new Error("Parse error on line 2"))).toBe(false);
  });
});

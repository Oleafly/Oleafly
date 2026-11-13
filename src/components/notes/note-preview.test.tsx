// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import "./tests/setup";

const mermaid = vi.hoisted(() => ({ renderDiagram: vi.fn() }));
vi.mock("@/components/ui/mermaid-diagram", () => mermaid);

import { clearMarkdownDocumentCache } from "@/components/ui/markdown-renderer";
import {
  NoteMarkdown,
  NotePreview,
  PREVIEW_BLOCK_TEXT,
  PREVIEW_BLOCKS,
  PREVIEW_SCALE,
  PREVIEW_TABLE,
} from "./note-preview";
import { resetRemoteImagesForTest } from "@/lib/remote-image";
import { NOTE_COLOR_HEX } from "./note-icons";

const FENCE = "```";
const SVG_URL = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E";

function preview(source: string, resolveAsset?: (noteId: string, path: string) => Promise<string | null>) {
  const view = render(<NotePreview noteId="n1" source={source} resolveAsset={resolveAsset} />);
  const root = view.container.querySelector<HTMLElement>("[data-note-preview]");
  const page = root?.querySelector<HTMLElement>(".ProseMirror");
  if (!root || !page) throw new Error("no preview");
  return { ...view, root, page };
}

beforeEach(() => {
  clearMarkdownDocumentCache();
  resetRemoteImagesForTest();
  mermaid.renderDiagram.mockReset();
  mermaid.renderDiagram.mockResolvedValue(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
  document.documentElement.classList.remove("dark");
});

describe("NotePreview", () => {
  it("lays the note out at editor width and shrinks it", () => {
    const { root } = preview("Hello");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveAttribute("inert");
    expect(root).toHaveAttribute("data-note-preview", "n1");
    const sheet = root.firstElementChild as HTMLElement;
    expect(sheet.style.transform).toBe(`scale(${PREVIEW_SCALE})`);
    expect(sheet.style.width).toMatch(/^calc\((?:100cqw \/ 0\.28|357\.14\d*cqw)\)$/u);
  });

  it("renders headings, lists, tables, code, quotes and math the way the note does", () => {
    const { page } = preview(
      [
        "## Results",
        "Run 3 reached **64.1%** with $x^2$.",
        "- one\n- two",
        "1. first\n2. second",
        "> quoted",
        "| a | b |\n| --- | --- |\n| 1 | 2 |",
        `${FENCE}python\nprint(1)\n${FENCE}`,
        "$$\nE = mc^2\n$$",
        "---",
      ].join("\n\n"),
    );
    expect(page.querySelector("h2")).toHaveTextContent("Results");
    expect(page.querySelector("strong")).toHaveTextContent("64.1%");
    expect(page.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(page.querySelectorAll("ul > li")).toHaveLength(2);
    expect(page.querySelectorAll("ol > li")).toHaveLength(2);
    expect(page.querySelector("blockquote")).toHaveTextContent("quoted");
    expect(page.querySelector("th")).toHaveTextContent("a");
    expect(page.querySelector("pre code.language-python")).toHaveTextContent("print(1)");
    expect(page.querySelector("hr")).toBeInTheDocument();
  });

  it("draws links and task boxes as plain text so nothing in a card can be clicked", () => {
    const { root } = preview("[docs](https://example.com) and [a note](oleafly://note/1)\n\n- [x] done\n- [ ] open");
    expect(root.querySelector("a, input, button")).toBeNull();
    const boxes = root.querySelectorAll<HTMLElement>("[data-checked]");
    expect([...boxes].map((box) => box.dataset.checked)).toEqual(["true", "false"]);
    expect(boxes[0].querySelector("svg")).not.toBeNull();
    expect(boxes[1].querySelector("svg")).toBeNull();
  });

  it("stops after the block budget", () => {
    const source = Array.from({ length: PREVIEW_BLOCKS + 10 }, (_, index) => `Paragraph ${index}`).join("\n\n");
    const { page } = preview(source);
    expect(page.querySelectorAll("p")).toHaveLength(PREVIEW_BLOCKS);
    expect(page.querySelectorAll("p")[PREVIEW_BLOCKS - 1]).toHaveTextContent(`Paragraph ${PREVIEW_BLOCKS - 1}`);
  });

  it("counts nested list items and table rows against the budget", () => {
    const list = Array.from({ length: PREVIEW_BLOCKS }, (_, index) => `- item ${index}`).join("\n");
    const { page } = preview(`${list}\n\nAfter the list`);
    expect(page.querySelectorAll("li")).toHaveLength(PREVIEW_BLOCKS);
    expect(page).not.toHaveTextContent("After the list");
  });

  it("cuts long block text and leaves math whole", () => {
    const { page } = preview(`${"word ".repeat(400)}$a+b$ tail`);
    const text = page.querySelector("p")?.textContent ?? "";
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(PREVIEW_BLOCK_TEXT + 1);
    const math = preview(`${"x".repeat(PREVIEW_BLOCK_TEXT - 5)} $\\frac{a}{b}$ more`).page;
    expect(math.querySelector(".katex")).toBeInTheDocument();
  });

  it("cuts tables to six rows and six columns", () => {
    const header = `| ${Array.from({ length: 8 }, (_, index) => `h${index}`).join(" | ")} |`;
    const rule = `| ${Array.from({ length: 8 }, () => "---").join(" | ")} |`;
    const rows = Array.from({ length: 9 }, (_, row) => `| ${Array.from({ length: 8 }, (_, cell) => `${row}.${cell}`).join(" | ")} |`);
    const { page } = preview([header, rule, ...rows].join("\n"));
    expect(page.querySelectorAll("tr")).toHaveLength(PREVIEW_TABLE);
    for (const row of page.querySelectorAll("tr")) expect(row.querySelectorAll("th, td")).toHaveLength(PREVIEW_TABLE);
  });

  it("puts a picture on its own line in the note's figure and loads note files through the note", async () => {
    const resolveAsset = vi.fn(async () => SVG_URL);
    const { page } = preview("![Loss](assets/loss.svg)\n\nText with ![inline](https://example.com/a.png) image", resolveAsset);
    const figure = page.querySelector("figure.note-image");
    expect(figure).toBeInTheDocument();
    await waitFor(() => expect(figure?.querySelector("img")).toHaveAttribute("src", SVG_URL));
    expect(figure?.querySelector("img")).toHaveAttribute("alt", "Loss");
    expect(resolveAsset).toHaveBeenCalledWith("n1", "assets/loss.svg");
    expect(page.querySelector("p img")).toBeNull();
    const held = page.querySelector<HTMLElement>("p [data-remote-image]");
    expect(held?.dataset.remoteImage).toBe("example.com");
    expect(held).toHaveTextContent(enCommon.remoteImage.blocked.replace("{{host}}", "example.com"));
    expect(held?.querySelector("button")).toBeNull();
  });

  it("shows a web picture in a card once the person loaded it, and offers to load it in a full preview", async () => {
    const full = render(<NoteMarkdown noteId="n2" source="![chart](https://example.com/b.png)" full />);
    const load = screen.getByRole("button", { name: enCommon.remoteImage.load });
    expect(full.container.querySelector("img")).toBeNull();
    const card = preview("Card ![chart](https://example.com/b.png)");
    expect(card.page.querySelector("img")).toBeNull();
    act(() => load.click());
    expect(full.container.querySelector("img")).toHaveAttribute("src", "https://example.com/b.png");
    expect(card.page.querySelector("img")).toHaveAttribute("src", "https://example.com/b.png");
  });

  it("shows a missing picture as an empty frame", async () => {
    const missing = preview("![gone](assets/gone.png)", vi.fn(async () => null));
    await waitFor(() => expect(missing.page.querySelector("[data-preview-missing] svg")).toHaveClass("lucide-image-off"));
    missing.unmount();
    const failed = preview("![broken](assets/broken.png)", vi.fn(async () => Promise.reject(new Error("unreadable"))));
    await waitFor(() => expect(failed.page.querySelector("[data-preview-missing]")).toBeInTheDocument());
    failed.unmount();
    const outside = preview("![escape](../secret.png)", vi.fn(async () => SVG_URL));
    expect(outside.page.querySelector("[data-preview-missing]")).toBeInTheDocument();
    outside.unmount();
    expect(preview("![file](assets/a.png)").page.querySelector("[data-preview-missing]")).toBeInTheDocument();
  });

  it("drops a late picture once the preview is gone", async () => {
    let finish: (url: string | null) => void = () => {};
    const resolveAsset = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
    );
    const view = preview("![late](assets/late.svg)", resolveAsset);
    expect(view.page.querySelector("img, [data-preview-missing]")).toBeNull();
    view.unmount();
    finish(SVG_URL);
    await Promise.resolve();
    expect(resolveAsset).toHaveBeenCalledOnce();
  });

  it("draws charts and LaTeX blocks, and labels the blocks it can't draw small", async () => {
    const chart = JSON.stringify({ categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }] });
    const { page } = preview(
      [
        `${FENCE}chart\n${chart}\n${FENCE}`,
        `${FENCE}{=latex}\n\\frac{1}{2}\n${FENCE}`,
        `${FENCE}{=latex}\n\\begin{nonsense\n${FENCE}`,
        `${FENCE}{=typst}\n$ x $\n${FENCE}`,
        `${FENCE}notebook\nassets/run.ipynb\n${FENCE}`,
      ].join("\n\n"),
    );
    const blocks = [...page.querySelectorAll<HTMLElement>(".note-drawn")];
    expect(blocks.map((block) => block.dataset.block)).toEqual(["chart", "latex", "latex", "typst", "notebook"]);
    expect(blocks.map((block) => block.firstElementChild?.textContent)).toEqual([
      enNotes.blocks.chart,
      "LaTeX",
      "LaTeX",
      "Typst",
      enNotes.notebook.label,
    ]);
    expect(blocks[0].querySelector(".note-drawn-preview svg")).toBeInTheDocument();
    expect(blocks[1].querySelector(".katex")).toBeInTheDocument();
    expect(blocks[2]).toHaveTextContent(enNotes.blocks.noPreview);
    expect(blocks[3].querySelector(".note-drawn-preview")).toHaveTextContent("$ x $");
    expect(blocks[4].querySelector(".note-drawn-preview")).toHaveTextContent("assets/run.ipynb");
    expect(page.querySelector("pre")).toBeNull();
  });

  it("draws Mermaid diagrams in the current theme and says when one fails", async () => {
    document.documentElement.classList.add("dark");
    const ok = preview(`${FENCE}mermaid\ngraph LR; A-->B\n${FENCE}`);
    expect(mermaid.renderDiagram).toHaveBeenCalledWith("graph LR; A-->B", "dark");
    await waitFor(() => expect(ok.page.querySelector(".note-drawn-preview svg")).toBeInTheDocument());
    ok.unmount();
    document.documentElement.classList.remove("dark");
    mermaid.renderDiagram.mockRejectedValueOnce(new Error("bad"));
    const failed = preview(`${FENCE}mermaid\nnot a graph\n${FENCE}`);
    expect(mermaid.renderDiagram).toHaveBeenLastCalledWith("not a graph", "light");
    await waitFor(() => expect(failed.page).toHaveTextContent(enNotes.blocks.diagramError));
  });

  it("ignores a diagram that finishes after the preview is gone", async () => {
    let finish: (svg: Element) => void = () => {};
    let fail: (error: Error) => void = () => {};
    mermaid.renderDiagram.mockImplementationOnce(
      () =>
        new Promise<Element>((resolve) => {
          finish = resolve;
        }),
    );
    mermaid.renderDiagram.mockImplementationOnce(
      () =>
        new Promise<Element>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const first = preview(`${FENCE}mermaid\ngraph TD; A\n${FENCE}`);
    const target = first.page.querySelector(".note-drawn-preview") as HTMLElement;
    first.unmount();
    finish(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    await Promise.resolve();
    expect(target.childElementCount).toBe(0);
    const second = preview(`${FENCE}mermaid\ngraph TD; B\n${FENCE}`);
    const other = second.page.querySelector(".note-drawn-preview") as HTMLElement;
    second.unmount();
    fail(new Error("late"));
    await Promise.resolve();
    expect(other.childElementCount).toBe(0);
  });

  it("keeps footnotes", () => {
    const { page } = preview("Footnote[^1]\n\n[^1]: The note.");
    expect(page.querySelector("section")).toHaveTextContent("The note.");
  });

  it("shows highlights in their colours and keeps any other HTML as text", () => {
    const { page } = preview(
      'One ==yellow **bold**== and <mark data-color="green">green *words*</mark>, [==linked==](https://e.com), `==code==`, x == y == z, <mark data-color="teal">teal</mark> <b onclick="x">b</b>.',
    );
    const marks = [...page.querySelectorAll<HTMLElement>("mark")];
    expect(marks.map((mark) => [mark.className, mark.dataset.color ?? null, mark.textContent])).toEqual([
      ["note-highlight", null, "yellow bold"],
      ["note-highlight", "green", "green words"],
      ["note-highlight", null, "linked"],
    ]);
    expect(marks[0].querySelector("strong")).toHaveTextContent("bold");
    expect(marks[1].querySelector("em")).toHaveTextContent("words");
    expect(page.querySelector("code")).toHaveTextContent("==code==");
    expect(page.querySelector("b")).toBeNull();
    expect(page).toHaveTextContent('x == y == z, <mark data-color="teal">teal</mark> <b onclick="x">b</b>.');
    expect(page).not.toHaveTextContent('<mark data-color="green">');
  });

  it("draws a resized picture at its width and keeps a width the note can't use as text", async () => {
    const resolveAsset = vi.fn(async () => SVG_URL);
    const { page } = preview("![Loss](assets/loss.svg){width=50%}\n\n![Tiny](assets/tiny.svg){width=5%}", resolveAsset);
    const figure = page.querySelector("figure.note-image");
    await waitFor(() => expect(figure?.querySelector("img")).toHaveAttribute("src", SVG_URL));
    expect(figure?.querySelector<HTMLElement>("img")?.style.width).toBe("50%");
    await waitFor(() => expect(page.querySelector("p img")).toHaveAttribute("src", SVG_URL));
    expect(page.querySelector<HTMLElement>("p img")?.style.width).toBe("");
    expect(page).not.toHaveTextContent("{width=50%}");
    expect(page).toHaveTextContent("{width=5%}");
  });
});

describe("note colour on the preview body", () => {
  it("gives the card preview and the hover or embed body the note's colour, and the default without one", () => {
    const card = render(<NotePreview noteId="n1" source="| a |\n| --- |\n| 1 |" color="mint" />);
    const sheet = card.container.querySelector<HTMLElement>("[data-note-preview] > .note-body");
    expect(sheet?.style.getPropertyValue("--note-color")).toBe(NOTE_COLOR_HEX.mint);
    expect(sheet?.style.getPropertyValue("--note-tint")).toBe("0");
    expect(sheet?.style.transform).toBe(`scale(${PREVIEW_SCALE})`);
    card.unmount();
    const hover = render(<NoteMarkdown noteId="n2" source="Hello" color="sky" />);
    expect(hover.container.querySelector<HTMLElement>(".note-body")?.style.getPropertyValue("--note-color")).toBe(NOTE_COLOR_HEX.sky);
    hover.unmount();
    const plain = render(<NoteMarkdown noteId="n3" source="Hello" />);
    const body = plain.container.querySelector<HTMLElement>(".note-body");
    expect(body?.style.getPropertyValue("--note-color")).toBe(NOTE_COLOR_HEX.blue);
    expect(body?.style.getPropertyValue("--note-tint")).toBe("1");
  });
});

describe("NoteMarkdown", () => {
  it("shows highlights and sized pictures in hover previews and embeds", async () => {
    const resolveAsset = vi.fn(async () => SVG_URL);
    const source = 'A <mark data-color="blue">blue</mark> and ==plain== word.\n\n![Chart](assets/chart.svg){width=40%}';
    for (const full of [false, true]) {
      const view = render(<NoteMarkdown noteId="n3" source={source} resolveAsset={resolveAsset} full={full} />);
      const marks = [...view.container.querySelectorAll<HTMLElement>("mark.note-highlight")];
      expect(marks.map((mark) => [mark.dataset.color ?? null, mark.textContent])).toEqual([
        ["blue", "blue"],
        [null, "plain"],
      ]);
      await waitFor(() => expect(view.container.querySelector("figure.note-image img")).toHaveAttribute("src", SVG_URL));
      expect(view.container.querySelector<HTMLElement>("figure.note-image img")?.style.width).toBe("40%");
      expect(view.container).not.toHaveTextContent("{width=40%}");
      view.unmount();
    }
  });
});

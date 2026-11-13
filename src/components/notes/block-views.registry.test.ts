// @vitest-environment jsdom
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { Editor, type JSONContent } from "@tiptap/core";
import { within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPIED_FEEDBACK_MS } from "@/components/ui/copyable-block";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import {
  BUILT_IN_BLOCKS,
  blockGroups,
  blockLabel,
  loadChemistry,
  paintStillBlock,
  withBlockViews,
  withImageView,
} from "./block-views";
import { noteBlock } from "./note-blocks";
import "./tests/setup";

const clipboard = vi.hoisted(() => ({ write: vi.fn(async (_text: string) => undefined) }));

vi.mock("@/lib/clipboard", () => ({ writeClipboardText: clipboard.write }));
vi.mock("./ArtifactFrame", () => ({ mountScriptedBlock: () => ({ render: vi.fn(), unmount: vi.fn() }) }));

const editors: Editor[] = [];

function build(content: JSONContent[], noteId?: string): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const resolve = vi.fn(async () => null);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions()
      .map(withBlockViews)
      .map((extension) => withImageView(extension, resolve, noteId)),
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}

function codeBlock(language: string, text: string): JSONContent {
  return { type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.useRealTimers();
});

describe("block registry", () => {
  it("registers every built-in block once, under a unique name", () => {
    const names = BUILT_IN_BLOCKS.map((kind) => kind.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(noteBlock(name)).toBeDefined();
    expect(blockLabel("pdb")).toBe(noteBlock("molecule")?.label());
    expect(blockLabel("unknown-kind")).toBe("unknown-kind");
  });

  it("groups every insertable block for the menus", () => {
    const grouped = blockGroups().flatMap((group) => group.kinds.map((kind) => kind.name));
    const insertable = BUILT_IN_BLOCKS.filter((kind) => kind.template)
      .map((kind) => kind.name);
    expect(new Set(grouped)).toEqual(new Set(insertable.filter((name) => grouped.includes(name))));
    expect(grouped).toEqual(["csv", "chart", "plot", "latex", "typst", "mermaid", "d2", "tikz", "circuitikz", "svg", "html", "jsx", "smiles", "molecule", "sequence"]);
    expect(insertable).not.toContain("notebook");
  });

  it("loads chemistry support once", () => {
    expect(loadChemistry()).toBe(loadChemistry());
  });
});

describe("Home previews", () => {
  it("draws cards for scripted and heavy blocks without running anything", () => {
    for (const kind of ["html", "jsx", "molecule", "notebook", "d2", "tikz", "circuitikz"]) {
      const preview = document.createElement("div");
      paintStillBlock(kind, preview, "first line\nsecond");
      expect([...preview.querySelectorAll("p")].map((line) => line.textContent)).toEqual([blockLabel(kind), "first line"]);
      expect(preview.querySelector("iframe, canvas")).toBeNull();
    }
  });

  it("uses a block's own still painter, its normal painter, or nothing", () => {
    const table = document.createElement("div");
    paintStillBlock("tsv", table, "a\tb\n1\t2");
    expect(table.querySelector("table")).not.toBeNull();
    const svg = document.createElement("div");
    paintStillBlock("svg", svg, '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    expect(svg.querySelector("img")).not.toBeNull();
    const none = document.createElement("div");
    expect(paintStillBlock("nothing", none, "x")).toBeTypeOf("function");
    expect(none.childElementCount).toBe(0);
  });
});

describe("editor block views", () => {
  it("draws chemistry LaTeX once mhchem is ready", async () => {
    const editor = build([codeBlock("{=latex}", String.raw`\ce{H2O}`)]);
    await vi.waitFor(() => expect(editor.view.dom.querySelector(".note-drawn-preview .katex")).not.toBeNull());
    expect(editor.view.dom.querySelector(".note-drawn-preview .katex-error")).toBeNull();
    expect(editor.view.dom.querySelector(".note-drawn-preview .katex-html")?.textContent).toContain("H");
  });

  it("drops a LaTeX chemistry render that finishes after the block changed", async () => {
    const editor = build([codeBlock("{=latex}", String.raw`\ce{CO2}`)]);
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    await loadChemistry();
    expect(editor.view.dom.querySelector(".katex")).toBeNull();
  });

  it("passes the note id and fence to scripted blocks and keeps their events", () => {
    const editor = build([codeBlock("TSX", "export default () => null;")], "note-9");
    const dom = editor.view.dom.querySelector(".note-drawn") as HTMLElement;
    expect(dom.dataset.block).toBe("jsx");
    const create = editor.extensionManager.nodeViews.codeBlock;
    const view = create(editor.state.doc.child(0), editor.view, () => 0, [], {} as never) as { stopEvent?: (event: Event) => boolean };
    expect(view.stopEvent).toBeTypeOf("function");
  });

  it("copies highlighted code and says so", async () => {
    vi.useFakeTimers();
    const editor = build([codeBlock("python", "print(1)")]);
    const button = within(editor.view.dom).getByRole("button", { name: enNotes.blocks.code.copyLabel });
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    button.click();
    await vi.waitFor(() => expect(button).toHaveAccessibleName(enNotes.blocks.code.copied));
    expect(clipboard.write).toHaveBeenCalledWith("print(1)");
    button.click();
    await vi.advanceTimersByTimeAsync(COPIED_FEEDBACK_MS);
    expect(button).toHaveAccessibleName(enNotes.blocks.code.copyLabel);
    clipboard.write.mockRejectedValueOnce(new Error("denied"));
    button.click();
    await vi.waitFor(() => expect(button).toHaveAccessibleName(enNotes.blocks.code.copyFailed));
    await vi.advanceTimersByTimeAsync(COPIED_FEEDBACK_MS);
    expect(button).toHaveAccessibleName(enNotes.blocks.code.copyLabel);
  });

  it("offers a copy button on a drawn block's source", async () => {
    const editor = build([codeBlock("mermaid", "flowchart LR\n  A --> B")]);
    const view = within(editor.view.dom);
    expect(view.queryByRole("button", { name: enNotes.blocks.code.copyLabel })).toBeNull();
    view.getByRole("button", { name: enNotes.blocks.source }).click();
    view.getByRole("button", { name: enNotes.blocks.code.copyLabel }).click();
    await vi.waitFor(() => expect(clipboard.write).toHaveBeenLastCalledWith("flowchart LR\n  A --> B"));
  });

  it("offers how to write a drawn block while its source is shown", () => {
    const editor = build([codeBlock("fasta", ">sample\nATG")]);
    const view = within(editor.view.dom);
    const name = enNotes.blocks.syntax.help.replace("{{block}}", blockLabel("sequence"));
    expect(view.queryByRole("button", { name })).toBeNull();
    view.getByRole("button", { name: enNotes.blocks.source }).click();
    expect(view.getByRole("button", { name })).toHaveAttribute("data-tooltip", enNotes.blocks.syntax.sequence);
    view.getByRole("button", { name: enNotes.blocks.preview }).click();
    expect(view.queryByRole("button", { name })).toBeNull();
  });

  it("copies the latest text and rebuilds when the language changes", async () => {
    const editor = build([codeBlock("python", "a = 1")]);
    editor.commands.insertContentAt(1, "b");
    within(editor.view.dom).getByRole("button", { name: enNotes.blocks.code.copyLabel }).click();
    await vi.waitFor(() => expect(clipboard.write).toHaveBeenLastCalledWith("ba = 1"));
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(0, undefined, { language: "rust" });
      return true;
    });
    expect((editor.view.dom.querySelector(".note-code-lang") as HTMLElement).dataset.language).toBe("rust");
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(0, undefined, { language: "chart" });
      return true;
    });
    expect(editor.view.dom.querySelector(".note-drawn")).not.toBeNull();
  });
});

// @vitest-environment jsdom
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import {
  paintSmiles,
  parseSmilesLine,
  parseSmilesSource,
  SMILES_LIMIT,
  SMILES_STILL_LIMIT,
  smilesBlock,
  structureMarkup,
} from "./smiles-block";
import "./tests/setup";

const drawer = vi.hoisted(() => ({
  fail: false,
  draws: [] as string[],
  onDraw: null as (() => void) | null,
}));

vi.mock("smiles-drawer", () => {
  class SvgDrawer {
    constructor() {
      if (drawer.fail) throw new Error("no drawer");
    }

    draw(tree: { smiles: string }, _target: null, theme: string) {
      drawer.draws.push(tree.smiles);
      drawer.onDraw?.();
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("data-smiles", tree.smiles);
      svg.setAttribute("data-theme", theme);
      return svg;
    }
  }
  return {
    default: {
      SvgDrawer,
      Parser: {
        parse(smiles: string) {
          if (smiles.includes("((")) throw new SyntaxError("bad smiles");
          return { smiles };
        },
      },
    },
  };
});

const copy = enNotes.blocks.smiles;

function preview(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function images(element: HTMLElement): HTMLImageElement[] {
  return [...element.querySelectorAll("img")];
}

function decoded(image: HTMLImageElement): string {
  return decodeURIComponent(image.src.replace("data:image/svg+xml;charset=utf-8,", ""));
}

afterEach(() => {
  drawer.fail = false;
  drawer.draws = [];
  drawer.onDraw = null;
  document.body.replaceChildren();
  document.documentElement.classList.remove("dark");
});

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("parseSmilesLine", () => {
  it.each([
    ["Aspirin: CC(=O)OC1=CC=CC=C1C(=O)O", { name: "Aspirin", smiles: "CC(=O)OC1=CC=CC=C1C(=O)O" }],
    ["Vitamin C:   OC[C@H](O)[C@H]1OC(=O)C(O)=C1O  ", { name: "Vitamin C", smiles: "OC[C@H](O)[C@H]1OC(=O)C(O)=C1O" }],
    ["[CH3:1][CH2:2]O", { name: null, smiles: "[CH3:1][CH2:2]O" }],
    ["Mapped: [CH3:1]O trailing words", { name: "Mapped", smiles: "[CH3:1]O" }],
    ["CCO ethanol absolute", { name: "ethanol absolute", smiles: "CCO" }],
    ["c1ccccc1", { name: null, smiles: "c1ccccc1" }],
  ])("reads %s", (line, entry) => {
    expect(parseSmilesLine(line)).toEqual(entry);
  });

  it.each(["", "   ", "# a comment", "  #indented comment"])("skips %j", (line) => {
    expect(parseSmilesLine(line)).toBeNull();
  });

  it("does not take an empty name", () => {
    expect(parseSmilesLine(": CCO")).toEqual({ name: "CCO", smiles: ":" });
  });
});

describe("parseSmilesSource", () => {
  it("keeps up to the limit and says when there are more", () => {
    const lines = Array.from({ length: SMILES_LIMIT + 2 }, (_, index) => `M${index}: ${"C".repeat(index + 1)}`);
    const list = parseSmilesSource(["# header", "", ...lines].join("\r\n"));
    expect(list.entries).toHaveLength(SMILES_LIMIT);
    expect(list.entries[0]).toEqual({ name: "M0", smiles: "C" });
    expect(list.more).toBe(true);
    expect(parseSmilesSource("CCO").more).toBe(false);
  });
});

describe("paintSmiles", () => {
  it("asks for SMILES when there are none", () => {
    const element = preview();
    expect(paintSmiles(element, "# only a comment\n", { still: false })).toBeUndefined();
    expect(element).toHaveTextContent(copy.empty);
  });

  it("draws each structure with its name, and a message for a bad line", async () => {
    const element = preview();
    const dispose = paintSmiles(element, "Ethanol: CCO\nC((C\nc1ccccc1 benzene ring\nCN", { still: false });
    expect(element.querySelector('[role="list"]')).toHaveAttribute("aria-label", copy.structures);
    expect(element.querySelectorAll('[role="listitem"]')).toHaveLength(4);
    await waitFor(() => expect(images(element)).toHaveLength(3));
    const [ethanol, benzene, plain] = images(element);
    expect(ethanol.alt).toBe("Structure of Ethanol");
    expect(decoded(ethanol)).toContain('data-smiles="CCO"');
    expect(decoded(ethanol)).toContain('data-theme="light"');
    expect(decoded(ethanol)).toContain('width="300"');
    expect(benzene.alt).toBe("Structure of benzene ring");
    expect(plain.alt).toBe("Structure of CN");
    const items = element.querySelectorAll<HTMLElement>('[role="listitem"]');
    expect(items[0]).toHaveTextContent("EthanolCCO");
    expect(items[1]).toHaveTextContent(copy.invalid);
    expect(items[1].dataset.invalid).toBe("true");
    expect(items[3].querySelectorAll("figcaption span")).toHaveLength(1);
    expect(element).not.toHaveTextContent(copy.more.replace("{{limit}}", String(SMILES_LIMIT)));
    dispose?.();
  });

  it("draws in the dark theme and notes structures past the limit", async () => {
    document.documentElement.classList.add("dark");
    const element = preview();
    const lines = Array.from({ length: SMILES_LIMIT + 1 }, (_, index) => "C".repeat(index + 1));
    paintSmiles(element, lines.join("\n"), { still: false });
    expect(element).toHaveTextContent(`Showing the first ${SMILES_LIMIT} structures.`);
    await waitFor(() => expect(images(element)).toHaveLength(SMILES_LIMIT));
    expect(decoded(images(element)[0])).toContain('data-theme="dark"');
  });

  it("draws only the first few on Home without the note", async () => {
    const element = preview();
    const lines = Array.from({ length: SMILES_LIMIT + 1 }, (_, index) => "C".repeat(index + 1));
    const still = smilesBlock.still;
    if (typeof still !== "function") throw new Error("expected a still painter");
    still(element, lines.join("\n"), { still: false });
    expect(element.querySelectorAll('[role="listitem"]')).toHaveLength(SMILES_STILL_LIMIT);
    expect(element).not.toHaveTextContent("Showing the first");
    await waitFor(() => expect(images(element)).toHaveLength(SMILES_STILL_LIMIT));
  });

  it("stops drawing after dispose", async () => {
    const element = preview();
    let dispose: (() => void) | undefined;
    drawer.onDraw = () => dispose?.();
    dispose = paintSmiles(element, "C\nCC\nCCC", { still: false });
    await waitFor(() => expect(drawer.draws).toEqual(["C"]));
    await nextTask();
    expect(drawer.draws).toEqual(["C"]);
    expect(images(element)).toHaveLength(1);
  });

  it("shows a message when the drawer can't load", async () => {
    drawer.fail = true;
    const element = preview();
    paintSmiles(element, "CCO", { still: false });
    await waitFor(() => expect(element).toHaveTextContent(copy.loadError));
  });

  it("keeps quiet when the drawer fails after dispose", async () => {
    drawer.fail = true;
    const element = preview();
    const dispose = paintSmiles(element, "CCO", { still: false });
    dispose?.();
    await nextTask();
    expect(element).not.toHaveTextContent(copy.loadError);
  });
});

describe("smilesBlock", () => {
  it("describes the smiles kind and a two molecule template", () => {
    expect(smilesBlock.name).toBe("smiles");
    expect(smilesBlock.label()).toBe(copy.label);
    expect(smilesBlock.interactive).toBeUndefined();
    const template = smilesBlock.template?.();
    expect(template?.info).toBe("smiles");
    expect(parseSmilesSource(template?.source ?? "").entries.map((entry) => entry.name)).toEqual([
      copy.template.caffeine,
      copy.template.aspirin,
    ]);
  });
});

describe("structureMarkup with the real drawer", () => {
  it("draws SVG markup and throws for a bad SMILES", async () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { default: library } = await vi.importActual<typeof import("smiles-drawer")>("smiles-drawer");
    const real = new library.SvgDrawer({ width: 300, height: 300 });
    const markup = structureMarkup(library, real, "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", "light");
    expect(markup).toMatch(/^<svg/u);
    expect(markup).toContain('width="300"');
    expect(markup).toContain("viewBox=");
    expect(() => structureMarkup(library, real, "C((", "dark")).toThrow();
    context.mockRestore();
  });
});

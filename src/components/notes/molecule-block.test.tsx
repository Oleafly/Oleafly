// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtomSpec, GLViewer } from "3dmol";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { BlockFileTooLargeError } from "./note-blocks";
import {
  applyStyle,
  atomStyle,
  captureListeners,
  isPolymer,
  moleculeBlock,
  moleculeProblemText,
  moleculeReadErrorText,
  MoleculeView,
  MoleculeViewError,
  type OpenedViewer,
  openViewer,
  paintMolecule,
  releaseViewer,
  ROTATE_STEP,
  runAction,
  spectrumRange,
  themeBackground,
  webglMode,
  cachedWebglMode,
  resetWebglModeForTest,
  ZOOM_STEP,
} from "./molecule-block";
import { MoleculeFileError, parseMoleculeSource, sniffMoleculeFormat } from "./molecule-source";
import "./tests/setup";

const SMALL: AtomSpec[] = [
  { atom: "C", elem: "C", hetflag: true, index: 0 },
  { atom: "O", elem: "O", hetflag: true, index: 1 },
];
const PROTEIN: AtomSpec[] = [
  { atom: "N", hetflag: false, resi: 1 },
  { atom: "CA", hetflag: false, resi: 1 },
  { atom: "CA", hetflag: false, resi: 2 },
  { atom: "O", hetflag: true, resi: 90, resn: "HOH" },
];

const lib = vi.hoisted(() => ({
  atoms: [] as AtomSpec[],
  viewers: [] as FakeViewerShape[],
  createError: false,
  createNothing: false,
  addModelError: false,
  styleError: false,
  formats: [] as string[],
  configs: [] as Record<string, unknown>[],
  listener: () => {},
}));

interface FakeViewerShape {
  host: HTMLElement;
  setStyle: ReturnType<typeof vi.fn>;
  addStyle: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  zoomTo: ReturnType<typeof vi.fn>;
  zoom: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  setView: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  setBackgroundColor: ReturnType<typeof vi.fn>;
  lose: ReturnType<typeof vi.fn>;
  divwatcher: { disconnect: ReturnType<typeof vi.fn> };
  intwatcher: { disconnect: ReturnType<typeof vi.fn> };
  canvas: HTMLCanvasElement;
}

vi.mock("3dmol", () => ({
  createViewer(host: HTMLElement, config: Record<string, unknown>) {
    if (lib.createError) throw "error creating viewer: no context";
    window.addEventListener("resize", lib.listener);
    document.body.addEventListener("mouseup", lib.listener);
    if (lib.createNothing) return undefined;
    lib.configs.push(config);
    const canvas = document.createElement("canvas");
    host.append(canvas);
    const lose = vi.fn();
    const viewer = {
      host,
      canvas,
      lose,
      setStyle: vi.fn(() => {
        if (lib.styleError) throw new Error("draw failed");
      }),
      addStyle: vi.fn(),
      render: vi.fn(),
      zoomTo: vi.fn(),
      zoom: vi.fn(),
      rotate: vi.fn(),
      setView: vi.fn(),
      clear: vi.fn(),
      setBackgroundColor: vi.fn(),
      divwatcher: { disconnect: vi.fn() },
      intwatcher: { disconnect: vi.fn() },
      getView: () => [1, 2, 3, 4, 0, 0, 0, 1],
      addModel(_data: string, format: string) {
        if (lib.addModelError) throw new Error("parse failed");
        lib.formats.push(format);
        return { selectedAtoms: () => lib.atoms };
      },
      getRenderer: () => ({
        context: { getExtension: () => ({ loseContext: lose }) },
        getCanvas: () => canvas,
      }),
    };
    lib.viewers.push(viewer);
    return viewer;
  },
}));

const copy = enNotes.blocks.molecule;
const XYZ = "3\nwater\nO 0 0 0.1173\nH 0 0.7572 -0.4692\nH 0 -0.7572 -0.4692";
const MOL = "\n  RDKit          3D\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n    1.2000    0.0000    0.0000 O   0  0\n  1  2  1  0\nM  END";

function fakeGl() {
  const loseContext = vi.fn();
  return { context: { getExtension: vi.fn(() => ({ loseContext })) }, loseContext };
}

function canvasContext() {
  return vi.mocked(HTMLCanvasElement.prototype.getContext);
}

function stubWebgl(available: boolean) {
  const gl = fakeGl();
  const spy = canvasContext().mockImplementation(((kind: string) =>
    available && kind === "webgl" ? gl.context : null) as never);
  return { spy, gl };
}

function fakeViewer(viewer: GLViewer): FakeViewerShape {
  return viewer as unknown as FakeViewerShape;
}

function preview(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function textUrl(text: string): string {
  return `data:chemical/x-xyz;base64,${btoa(text)}`;
}

beforeAll(async () => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

beforeEach(() => {
  lib.atoms = SMALL;
  lib.viewers = [];
  lib.formats = [];
  lib.configs = [];
  lib.createError = false;
  lib.createNothing = false;
  lib.addModelError = false;
  lib.styleError = false;
  resetWebglModeForTest();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => null) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.documentElement.classList.remove("dark");
  Reflect.deleteProperty(globalThis, "OffscreenCanvas");
});

describe("error text", () => {
  it("words read errors and parse problems", () => {
    expect(moleculeReadErrorText(new BlockFileTooLargeError(), "a.pdb")).toBe(copy.tooLarge);
    expect(moleculeReadErrorText(new MoleculeFileError("missing"), "a.pdb")).toBe("File not found: a.pdb");
    expect(moleculeReadErrorText(new MoleculeFileError("unreadable"), "a.pdb")).toBe("Couldn't read a.pdb.");
    expect(moleculeReadErrorText(new Error("x"), "a.pdb")).toBe("Couldn't read a.pdb.");
    expect(moleculeReadErrorText(new Error("x"), null)).toBe("Couldn't read .");
    expect(moleculeProblemText({ ok: false, problem: "format", value: "png" })).toBe(
      "Unknown format png. Use pdb, sdf, mol, xyz, cif or mol2.",
    );
    expect(moleculeProblemText({ ok: false, problem: "style", value: "x" })).toContain("Unknown style x.");
    expect(moleculeProblemText({ ok: false, problem: "color", value: "y" })).toContain("Unknown color y.");
    expect(moleculeProblemText({ ok: false, problem: "path", value: "" })).toBe(copy.badPath);
    expect(moleculeProblemText({ ok: false, problem: "empty", value: "" })).toBe(copy.empty);
  });
});

describe("webgl and colors", () => {
  it("prefers a shared offscreen context", () => {
    const gl = fakeGl();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return gl.context;
        }
      },
    );
    expect(webglMode()).toBe("shared");
    expect(gl.loseContext).toHaveBeenCalled();
  });

  it("falls back to a canvas of its own, or to nothing", () => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );
    const { spy, gl } = stubWebgl(true);
    expect(webglMode()).toBe("dedicated");
    expect(gl.loseContext).toHaveBeenCalled();
    spy.mockImplementation((() => null) as never);
    expect(webglMode()).toBeNull();
    spy.mockImplementation((() => {
      throw new Error("blocked");
    }) as never);
    expect(webglMode()).toBeNull();
  });

  it("uses the painted background, or a theme color when it is clear", () => {
    const element = preview();
    expect(themeBackground(element)).toBe("#ffffff");
    element.style.backgroundColor = "rgba(0, 0, 0, 0)";
    document.documentElement.classList.add("dark");
    expect(themeBackground(element)).toBe("#0a0a0a");
    let fill = "";
    canvasContext().mockImplementation((() => ({
      get fillStyle() {
        return fill;
      },
      set fillStyle(value: string) {
        fill = value;
      },
    })) as never);
    element.style.backgroundColor = "rgb(10, 20, 255)";
    expect(themeBackground(element)).toBe("#0a14ff");
  });
});

describe("captureListeners", () => {
  it("removes the listeners a call added to the targets", () => {
    const target = new EventTarget();
    const before = vi.fn();
    const during = vi.fn();
    const after = vi.fn();
    target.addEventListener("ping", before);
    const { value, release } = captureListeners([target], () => {
      target.addEventListener("ping", during);
      target.addEventListener("ping", null);
      return 7;
    });
    target.addEventListener("ping", after);
    expect(value).toBe(7);
    expect(Object.hasOwn(target, "addEventListener")).toBe(false);
    target.dispatchEvent(new Event("ping"));
    expect(during).toHaveBeenCalledTimes(1);
    release();
    target.dispatchEvent(new Event("ping"));
    expect(before).toHaveBeenCalledTimes(2);
    expect(after).toHaveBeenCalledTimes(2);
    expect(during).toHaveBeenCalledTimes(1);
  });

  it("restores an own addEventListener and cleans up when the call throws", () => {
    const target = new EventTarget();
    const own = EventTarget.prototype.addEventListener;
    Object.defineProperty(target, "addEventListener", { configurable: true, writable: true, value: own });
    const during = vi.fn();
    expect(() =>
      captureListeners([target], () => {
        target.addEventListener("ping", during);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(Object.getOwnPropertyDescriptor(target, "addEventListener")?.value).toBe(own);
    target.dispatchEvent(new Event("ping"));
    expect(during).not.toHaveBeenCalled();
  });
});

describe("styles", () => {
  const residues = { prop: "resi", min: 1, max: 9 } as const;

  it("maps styles and colors to 3Dmol specs", () => {
    expect(atomStyle("cartoon", "spectrum", residues)).toEqual({ cartoon: { color: "spectrum" } });
    expect(atomStyle("stick", "spectrum", residues)).toEqual({
      stick: { colorscheme: { prop: "resi", gradient: "roygb", min: 1, max: 9 }, radius: 0.2 },
    });
    expect(atomStyle("sphere", "element", residues)).toEqual({ sphere: { colorscheme: "default", scale: 0.9 } });
    expect(atomStyle("line", "chain", residues)).toEqual({ line: { colorscheme: "chain" } });
    expect(atomStyle("cartoon", "residue", residues)).toEqual({ cartoon: { colorscheme: "amino" } });
    expect(atomStyle("cartoon", "ss", residues)).toEqual({ cartoon: { colorscheme: "ssJmol" } });
  });

  it("finds a residue range or falls back to atom order", () => {
    expect(spectrumRange(PROTEIN)).toEqual({ prop: "resi", min: 1, max: 90 });
    expect(spectrumRange(SMALL)).toEqual({ prop: "index", min: 0, max: 1 });
    expect(spectrumRange([{ resi: 4 }])).toEqual({ prop: "index", min: 0, max: 1 });
  });

  it("detects polymers by their backbone", () => {
    expect(isPolymer(PROTEIN)).toBe(true);
    expect(isPolymer([{ atom: "P" }, { atom: "P", hetflag: false }])).toBe(true);
    expect(isPolymer([{ atom: "CA", hetflag: false }, { atom: "CA", hetflag: true }])).toBe(false);
    expect(isPolymer(SMALL)).toBe(false);
  });
});

describe("viewer lifecycle", () => {
  async function library() {
    return import("3dmol");
  }

  it("opens a dedicated viewer, passes the format and releases everything", async () => {
    const listener = vi.fn();
    lib.listener = listener;
    const host = preview();
    const opened = openViewer(await library(), host, "#123456", MOL, "mol", "dedicated");
    expect(lib.formats).toEqual(["sdf"]);
    expect(lib.configs[0]).toEqual({ backgroundColor: "#123456", antialias: true, rows: 1, cols: 1, row: 0, col: 0 });
    expect("OffscreenCanvas" in globalThis).toBe(true);
    expect(opened.polymer).toBe(false);
    expect(opened.range).toEqual({ prop: "index", min: 0, max: 1 });
    const viewer = fakeViewer(opened.viewer);
    opened.release();
    window.dispatchEvent(new Event("resize"));
    document.body.dispatchEvent(new Event("mouseup"));
    expect(listener).not.toHaveBeenCalled();
    expect(viewer.clear).toHaveBeenCalled();
    expect(viewer.divwatcher.disconnect).toHaveBeenCalled();
    expect(viewer.intwatcher.disconnect).toHaveBeenCalled();
    expect(viewer.lose).toHaveBeenCalled();
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("keeps the shared context until the last shared viewer goes", async () => {
    const three = await library();
    const first = openViewer(three, preview(), "#fff", XYZ, "xyz", "shared");
    const second = openViewer(three, preview(), "#fff", XYZ, "xyz", "shared");
    expect(lib.configs[0]).toEqual({ backgroundColor: "#fff", antialias: true });
    first.release();
    expect(fakeViewer(first.viewer).lose).not.toHaveBeenCalled();
    second.release();
    expect(fakeViewer(second.viewer).lose).toHaveBeenCalled();
  });

  it("survives a viewer that fails to clear", async () => {
    const opened = openViewer(await library(), preview(), "#fff", XYZ, "xyz", "dedicated");
    const viewer = fakeViewer(opened.viewer);
    viewer.clear.mockImplementation(() => {
      throw new Error("lost");
    });
    viewer.lose.mockImplementation(() => {
      throw new Error("already lost");
    });
    expect(() => releaseViewer(opened.viewer, "dedicated", () => {})).not.toThrow();
  });

  it("reports WebGL failures and empty models", async () => {
    const three = await library();
    const listener = vi.fn();
    lib.listener = listener;
    lib.createError = true;
    expect(() => openViewer(three, preview(), "#fff", XYZ, "xyz", "shared")).toThrow(MoleculeViewError);
    lib.createError = false;
    lib.createNothing = true;
    expect(() => openViewer(three, preview(), "#fff", XYZ, "xyz", "shared")).toThrow(
      expect.objectContaining({ problem: "webgl" }),
    );
    window.dispatchEvent(new Event("resize"));
    expect(listener).not.toHaveBeenCalled();
    lib.createNothing = false;
    lib.atoms = [];
    expect(() => openViewer(three, preview(), "#fff", XYZ, "xyz", "shared")).toThrow(
      expect.objectContaining({ problem: "atoms" }),
    );
    lib.atoms = SMALL;
    const survivor = openViewer(three, preview(), "#fff", XYZ, "xyz", "shared");
    survivor.release();
    expect(fakeViewer(survivor.viewer).lose).toHaveBeenCalled();
    lib.atoms = [];
    lib.addModelError = true;
    expect(() => openViewer(three, preview(), "#fff", XYZ, "xyz", "dedicated")).toThrow(
      expect.objectContaining({ problem: "atoms" }),
    );
  });

  it("applies styles, shows ligands as sticks with cartoons, and runs the view actions", async () => {
    lib.atoms = PROTEIN;
    const opened: OpenedViewer = openViewer(await library(), preview(), "#fff", "ATOM  ", "pdb", "dedicated");
    opened.view = [9];
    const viewer = fakeViewer(opened.viewer);
    applyStyle(opened, "cartoon", "spectrum");
    expect(viewer.setStyle).toHaveBeenLastCalledWith({}, { cartoon: { color: "spectrum" } });
    const [selection, ligand] = viewer.addStyle.mock.calls[0] as [{ predicate: (atom: AtomSpec) => boolean }, unknown];
    expect(ligand).toEqual({ stick: { colorscheme: "default", radius: 0.2 } });
    expect(selection.predicate({ hetflag: true, resn: "LIG" })).toBe(true);
    expect(selection.predicate({ hetflag: true, resn: "HOH" })).toBe(false);
    expect(selection.predicate({ hetflag: true })).toBe(true);
    expect(selection.predicate({ hetflag: false, resn: "ALA" })).toBe(false);
    applyStyle(opened, "cartoon", "chain");
    expect(viewer.addStyle).toHaveBeenLastCalledWith(expect.anything(), { stick: { colorscheme: "chain", radius: 0.2 } });
    applyStyle(opened, "line", "element");
    expect(viewer.addStyle).toHaveBeenCalledTimes(2);
    runAction(opened, "rotateLeft");
    expect(viewer.rotate).toHaveBeenLastCalledWith(-ROTATE_STEP, "vy");
    runAction(opened, "rotateRight");
    expect(viewer.rotate).toHaveBeenLastCalledWith(ROTATE_STEP, "vy");
    runAction(opened, "zoomIn");
    expect(viewer.zoom).toHaveBeenLastCalledWith(ZOOM_STEP);
    runAction(opened, "zoomOut");
    expect(viewer.zoom).toHaveBeenLastCalledWith(1 / ZOOM_STEP);
    runAction(opened, "reset");
    expect(viewer.setView).toHaveBeenCalledWith([9]);
    opened.release();
  });
});

describe("MoleculeView", () => {
  it("loads a small molecule as sticks with element colors and labelled controls", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MoleculeView data={XYZ} format="xyz" style={null} color={null} mode="dedicated" />);
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    const style = await screen.findByRole("combobox", { name: copy.style });
    expect(style).toHaveTextContent(copy.styles.stick);
    expect(screen.getByRole("combobox", { name: copy.color })).toHaveTextContent(copy.colors.element);
    expect(screen.getByRole("group", { name: copy.controls })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: copy.viewer })).toBeInTheDocument();
    expect(screen.queryByText(copy.loading)).toBeNull();
    const viewer = lib.viewers[0];
    expect(viewer.zoomTo).toHaveBeenCalled();
    expect(viewer.setStyle).toHaveBeenLastCalledWith({}, { stick: { colorscheme: "default", radius: 0.2 } });
    await user.click(style);
    await user.click(await screen.findByRole("option", { name: copy.styles.sphere }));
    expect(viewer.setStyle).toHaveBeenLastCalledWith({}, { sphere: { colorscheme: "default", scale: 0.9 } });
    await user.click(screen.getByRole("combobox", { name: copy.color }));
    await user.click(await screen.findByRole("option", { name: copy.colors.chain }));
    expect(viewer.setStyle).toHaveBeenLastCalledWith({}, { sphere: { colorscheme: "chain", scale: 0.9 } });
    await user.click(screen.getByRole("button", { name: copy.rotateLeft }));
    expect(viewer.rotate).toHaveBeenCalledWith(-ROTATE_STEP, "vy");
    await user.click(screen.getByRole("button", { name: copy.rotateRight }));
    await user.click(screen.getByRole("button", { name: copy.zoomIn }));
    await user.click(screen.getByRole("button", { name: copy.zoomOut }));
    expect(viewer.zoom).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: copy.reset }));
    expect(viewer.setView).toHaveBeenCalledWith([1, 2, 3, 4, 0, 0, 0, 1]);
    document.documentElement.classList.add("dark");
    await waitFor(() => expect(viewer.setBackgroundColor).toHaveBeenCalledWith("#0a0a0a", 1));
    unmount();
    expect(viewer.clear).toHaveBeenCalled();
    expect(viewer.lose).toHaveBeenCalled();
  });

  it("reports each style and color the person picks so the block can keep it", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<MoleculeView data={XYZ} format="xyz" style={null} color={null} mode="dedicated" onChoose={onChoose} />);
    await user.click(await screen.findByRole("combobox", { name: copy.style }));
    await user.click(await screen.findByRole("option", { name: copy.styles.line }));
    await user.click(screen.getByRole("combobox", { name: copy.color }));
    await user.click(await screen.findByRole("option", { name: copy.colors.residue }));
    expect(onChoose.mock.calls).toEqual([
      ["style", "line"],
      ["color", "residue"],
    ]);
    expect(screen.getByRole("combobox", { name: copy.style })).toHaveTextContent(copy.styles.line);
  });

  it("shows proteins as a spectrum cartoon and keeps a chosen style and color", async () => {
    lib.atoms = PROTEIN;
    render(<MoleculeView data="ATOM  " format="pdb" style={null} color={null} mode="shared" />);
    expect(await screen.findByRole("combobox", { name: copy.style })).toHaveTextContent(copy.styles.cartoon);
    expect(screen.getByRole("combobox", { name: copy.color })).toHaveTextContent(copy.colors.spectrum);
    const other = render(<MoleculeView data="ATOM  " format="pdb" style="line" color="residue" mode="shared" />);
    const [, style] = await within(other.container).findAllByRole("combobox");
    expect(within(other.container).getAllByRole("combobox")[0]).toHaveTextContent(copy.styles.line);
    expect(style).toHaveTextContent(copy.colors.residue);
  });

  it("explains WebGL and empty model problems", async () => {
    lib.createError = true;
    const first = render(<MoleculeView data={XYZ} format="xyz" style={null} color={null} mode="dedicated" />);
    expect(await within(first.container).findByText(copy.noWebgl)).toBeInTheDocument();
    expect(within(first.container).queryByRole("group")).toBeNull();
    lib.createError = false;
    lib.atoms = [];
    const second = render(<MoleculeView data={XYZ} format="xyz" style={null} color={null} mode="dedicated" />);
    expect(await within(second.container).findByText(copy.noAtoms)).toBeInTheDocument();
  });

  it("releases a viewer whose first draw fails", async () => {
    lib.styleError = true;
    render(<MoleculeView data={XYZ} format="xyz" style="stick" color="element" mode="dedicated" />);
    expect(await screen.findByText(copy.noAtoms)).toBeInTheDocument();
    expect(lib.viewers[0].clear).toHaveBeenCalled();
    expect(lib.viewers[0].lose).toHaveBeenCalled();
  });

  it("does nothing when unmounted before the library loads", async () => {
    const { unmount } = render(<MoleculeView data={XYZ} format="xyz" style={null} color={null} mode="dedicated" />);
    unmount();
    await settle();
    expect(lib.viewers).toHaveLength(0);
  });
});

describe("paintMolecule", () => {
  it("draws a card on Home and when files can't be read", () => {
    const element = preview();
    expect(paintMolecule(element, XYZ, { still: true })).toBeUndefined();
    expect(element.querySelector("p")).toHaveTextContent(copy.label);
    paintMolecule(element, "path: assets/a.pdb", { still: false });
    expect(element.querySelectorAll("p")[1]).toHaveTextContent("path: assets/a.pdb");
  });

  it("explains source problems", () => {
    const element = preview();
    expect(paintMolecule(element, "style: ribbon\nx", { still: false })).toBeUndefined();
    expect(element).toHaveTextContent("Unknown style ribbon.");
  });

  it("probes WebGL once it works and keeps asking while it does not", () => {
    stubWebgl(false);
    expect(cachedWebglMode()).toBeNull();
    stubWebgl(true);
    expect(cachedWebglMode()).toBe("dedicated");
    const calls = canvasContext().mock.calls.length;
    expect(cachedWebglMode()).toBe("dedicated");
    expect(canvasContext().mock.calls).toHaveLength(calls);
  });

  it("explains missing WebGL", () => {
    stubWebgl(false);
    const element = preview();
    paintMolecule(element, XYZ, { still: false });
    expect(element).toHaveTextContent(copy.noWebgl);
  });

  it("saves a picked style into the block's source", async () => {
    stubWebgl(true);
    const user = userEvent.setup();
    const element = preview();
    let source = `style: line\n${XYZ}`;
    const rewrite = vi.fn((change: (current: string) => string) => {
      source = change(source);
    });
    const dispose = paintMolecule(element, source, { still: false, rewrite });
    await user.click(await within(element).findByRole("combobox", { name: copy.style }));
    await user.click(await screen.findByRole("option", { name: copy.styles.sphere }));
    expect(rewrite).toHaveBeenCalledOnce();
    expect(source).toBe(`style: sphere\n${XYZ}`);
    dispose?.();
    await settle();
  });

  it("mounts the viewer and removes it on dispose", async () => {
    stubWebgl(true);
    const element = preview();
    const dispose = paintMolecule(element, `style: line\n${XYZ}`, { still: false, fence: "molecule" });
    expect(element).toHaveTextContent(copy.loading);
    await waitFor(() => expect(within(element).getByRole("combobox", { name: copy.style })).toHaveTextContent(copy.styles.line));
    expect(lib.formats).toEqual(["xyz"]);
    dispose?.();
    await settle();
    expect(element.querySelector(".note-molecule")).toBeNull();
    expect(lib.viewers[0].clear).toHaveBeenCalled();
  });

  it("reads a file and uses its extension for the format", async () => {
    stubWebgl(true);
    const element = preview();
    const dispose = paintMolecule(element, "path: assets/water.sdf", {
      still: false,
      readFile: async () => textUrl(MOL.slice(1)),
    });
    await waitFor(() => expect(lib.formats).toEqual(["sdf"]));
    dispose?.();
    await settle();
  });

  it("reports read errors and unknown formats", async () => {
    stubWebgl(true);
    const element = preview();
    paintMolecule(element, "path: assets/a.pdb", { still: false, readFile: async () => null });
    await waitFor(() => expect(element).toHaveTextContent("File not found: assets/a.pdb"));
    paintMolecule(element, "nothing to see", { still: false });
    await waitFor(() => expect(element).toHaveTextContent(copy.unknownFormat));
  });

  it("ignores results that arrive after dispose", async () => {
    stubWebgl(true);
    const element = preview();
    let finish: (value: string | null) => void = () => {};
    const dispose = paintMolecule(element, "path: a.xyz", {
      still: false,
      readFile: () => new Promise((resolve) => (finish = resolve)),
    });
    dispose?.();
    finish(null);
    await settle();
    expect(element).toHaveTextContent(copy.loading);
    const again = paintMolecule(element, "path: b.xyz", { still: false, readFile: async () => textUrl(XYZ) });
    again?.();
    await settle();
    expect(lib.viewers).toHaveLength(0);
  });
});

describe("moleculeBlock", () => {
  it("describes the molecule kind and an offline ethanol template", () => {
    expect(moleculeBlock.name).toBe("molecule");
    expect(moleculeBlock.aliases).toEqual(["pdb", "mol", "sdf", "xyz", "cif", "mol2"]);
    expect(moleculeBlock.label()).toBe(copy.label);
    expect(moleculeBlock.still).toBe("card");
    expect(moleculeBlock.interactive).toBe(true);
    const template = moleculeBlock.template?.();
    expect(template?.info).toBe("molecule");
    const parsed = parseMoleculeSource(template?.source ?? "");
    expect(parsed).toMatchObject({ ok: true, spec: { format: "xyz", style: "stick" } });
    if (parsed.ok) {
      expect(sniffMoleculeFormat(parsed.spec.data)).toBe("xyz");
      expect(parsed.spec.data.split("\n")).toHaveLength(11);
      expect(parsed.spec.data.split("\n")[1]).toBe(copy.template);
    }
  });
});

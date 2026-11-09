// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtomSpec, GLViewer } from "3dmol";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { BlockFileTooLargeError } from "./note-blocks";
import {
  applyStyle,
  atomStyle,
  captureListeners,
  cssColorHex,
  isPolymer,
  liveSharedViewers,
  MoleculeFileError,
  moleculeBlock,
  moleculeData,
  moleculeProblemText,
  moleculeReadErrorText,
  moleculeText,
  MoleculeView,
  MoleculeViewError,
  type OpenedViewer,
  openViewer,
  paintMolecule,
  parseMoleculeSource,
  releaseViewer,
  repairMolHeader,
  resolveMoleculeFormat,
  ROTATE_STEP,
  runAction,
  sniffMoleculeFormat,
  spectrumRange,
  themeBackground,
  webglMode,
  cachedWebglMode,
  forgetWebglMode,
  ZOOM_STEP,
} from "./molecule-block";

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

class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  unobserve(element: Element) {
    this.observed = this.observed.filter((candidate) => candidate !== element);
  }

  disconnect() {
    this.disconnected = true;
  }

  fire(isIntersecting: boolean) {
    this.callback(
      this.observed.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
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
  await loadNamespace("notes");
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
  FakeObserver.instances = [];
  forgetWebglMode();
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

describe("parseMoleculeSource", () => {
  it("reads options before the inline data", () => {
    expect(parseMoleculeSource(`format: XYZ\nstyle: Sphere\ncolour: chain\n${XYZ}`)).toEqual({
      ok: true,
      spec: { path: null, format: "xyz", style: "sphere", color: "chain", data: XYZ },
    });
    expect(parseMoleculeSource("format: mmcif\ncolor: ss\ndata_x\nloop_")).toMatchObject({
      ok: true,
      spec: { format: "cif", color: "ss", style: null },
    });
  });

  it("reads a file path and ignores inline text with it", () => {
    expect(parseMoleculeSource("path: ./assets/1abc.pdb\nATOM  1")).toEqual({
      ok: true,
      spec: { path: "assets/1abc.pdb", format: null, style: null, color: null, data: "" },
    });
  });

  it.each([
    ["format: png\nx", "format", "png"],
    ["style: ribbon\nx", "style", "ribbon"],
    ["color: rainbow\nx", "color", "rainbow"],
    ["path: ../x.pdb", "path", "../x.pdb"],
    ["style: stick\n\n", "empty", ""],
  ])("reports %j", (source, problem, value) => {
    expect(parseMoleculeSource(source)).toEqual({ ok: false, problem, value });
  });
});

describe("formats", () => {
  it.each([
    ["@<TRIPOS>MOLECULE\nwater", "mol2"],
    ["data_1ABC\nloop_\n_atom_site.id", "cif"],
    ["data_x\n_atom_site.id 1", "cif"],
    ["HEADER    PROTEIN\nATOM      1  N   MET A   1", "pdb"],
    ["HETATM    1  O   HOH A   1", "pdb"],
    [MOL, "sdf"],
    ["x\n$$$$\n", "sdf"],
    [XYZ, "xyz"],
    ["\n\n 2\n\nC 1.0 -2e-1 .5\n", "xyz"],
    ["3\nwater\nnot an atom line", null],
    ["3\nwater", null],
    ["hello", null],
    ["", null],
  ])("sniffs %j as %s", (text, format) => {
    expect(sniffMoleculeFormat(text)).toBe(format);
  });

  it("prefers the option, then the fence, then the extension, then the data", () => {
    const spec = { path: null, format: null, style: null, color: null, data: "" };
    expect(resolveMoleculeFormat({ ...spec, format: "pdb" }, "xyz", XYZ)).toBe("pdb");
    expect(resolveMoleculeFormat(spec, "mol2", XYZ)).toBe("mol2");
    expect(resolveMoleculeFormat({ ...spec, path: "a/b.ENT" }, "molecule", XYZ)).toBe("pdb");
    expect(resolveMoleculeFormat({ ...spec, path: "a/b.sd" }, undefined, XYZ)).toBe("sdf");
    expect(resolveMoleculeFormat({ ...spec, path: "a/b.txt" }, undefined, XYZ)).toBe("xyz");
    expect(resolveMoleculeFormat({ ...spec, path: "a/noext" }, undefined, "?")).toBeNull();
    expect(resolveMoleculeFormat(spec, undefined, XYZ)).toBe("xyz");
  });

  it("restores the three header lines of a MOL file", () => {
    const stripped = MOL.split("\n").slice(1).join("\n");
    expect(repairMolHeader(stripped).split("\n")[3]).toContain("V2000");
    expect(repairMolHeader(MOL)).toBe(MOL);
    expect(repairMolHeader("  2  1  0  0  0  0  0  0  0  0999 V3000")).toBe("\n\n\n  2  1  0  0  0  0  0  0  0  0999 V3000");
    expect(repairMolHeader("no counts line")).toBe("no counts line");
    expect(moleculeData("  1  0 V2000", "mol")).toBe("\n\n\n  1  0 V2000");
    expect(moleculeData("  1  0 V2000", "sdf")).toBe("\n\n\n  1  0 V2000");
    expect(moleculeData("  1  0 V2000", "xyz")).toBe("  1  0 V2000");
  });
});

describe("moleculeText", () => {
  const spec = { path: "a.xyz", format: null, style: null, color: null, data: "" };

  it("returns inline data or reads the file", async () => {
    expect(await moleculeText({ ...spec, path: null, data: XYZ }, undefined)).toBe(XYZ);
    expect(await moleculeText(spec, async () => textUrl(XYZ))).toBe(XYZ);
  });

  it("reports missing, unreadable and large files", async () => {
    await expect(moleculeText(spec, async () => null)).rejects.toMatchObject({ problem: "missing" });
    await expect(moleculeText(spec, undefined)).rejects.toMatchObject({ problem: "missing" });
    await expect(moleculeText(spec, async () => "plain")).rejects.toMatchObject({ problem: "unreadable" });
    await expect(moleculeText(spec, async () => `data:x;base64,${"A".repeat(9 * 1024 * 1024)}`)).rejects.toBeInstanceOf(
      BlockFileTooLargeError,
    );
  });

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

  it("turns a CSS color into hex through a canvas", () => {
    const data = { value: [10, 20, 255, 255] };
    const spy = canvasContext().mockImplementation((() => ({
      fillStyle: "",
      fillRect: vi.fn(),
      getImageData: () => ({ data: data.value }),
    })) as never);
    expect(cssColorHex("oklch(0.5 0.1 250)")).toBe("#0a14ff");
    data.value = [0, 0, 0, 0];
    expect(cssColorHex("transparent")).toBeNull();
    expect(cssColorHex("")).toBeNull();
    spy.mockImplementation((() => null) as never);
    expect(cssColorHex("red")).toBeNull();
  });

  it("falls back to a theme color for the background", () => {
    const element = preview();
    expect(themeBackground(element)).toBe("#ffffff");
    document.documentElement.classList.add("dark");
    expect(themeBackground(element)).toBe("#0a0a0a");
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
    expect(liveSharedViewers()).toBe(2);
    first.release();
    expect(fakeViewer(first.viewer).lose).not.toHaveBeenCalled();
    second.release();
    expect(fakeViewer(second.viewer).lose).toHaveBeenCalled();
    expect(liveSharedViewers()).toBe(0);
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
    expect(liveSharedViewers()).toBe(0);
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
    expect(style).toHaveValue("stick");
    expect(screen.getByRole("combobox", { name: copy.color })).toHaveValue("element");
    expect(screen.getByRole("group", { name: copy.controls })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: copy.viewer })).toBeInTheDocument();
    expect(screen.queryByText(copy.loading)).toBeNull();
    const viewer = lib.viewers[0];
    expect(viewer.zoomTo).toHaveBeenCalled();
    expect(viewer.setStyle).toHaveBeenLastCalledWith({}, { stick: { colorscheme: "default", radius: 0.2 } });
    await user.selectOptions(style, "sphere");
    expect(viewer.setStyle).toHaveBeenLastCalledWith({}, { sphere: { colorscheme: "default", scale: 0.9 } });
    await user.selectOptions(screen.getByRole("combobox", { name: copy.color }), "chain");
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

  it("shows proteins as a spectrum cartoon and keeps a chosen style and color", async () => {
    lib.atoms = PROTEIN;
    render(<MoleculeView data="ATOM  " format="pdb" style={null} color={null} mode="shared" />);
    expect(await screen.findByRole("combobox", { name: copy.style })).toHaveValue("cartoon");
    expect(screen.getByRole("combobox", { name: copy.color })).toHaveValue("spectrum");
    const other = render(<MoleculeView data="ATOM  " format="pdb" style="line" color="residue" mode="shared" />);
    const [, style] = await within(other.container).findAllByRole("combobox");
    expect(within(other.container).getAllByRole("combobox")[0]).toHaveValue("line");
    expect(style).toHaveValue("residue");
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
    expect(element.querySelector(".note-block-card-title")).toHaveTextContent(copy.label);
    paintMolecule(element, "path: assets/a.pdb", { still: false });
    expect(element.querySelector(".note-block-card-text")).toHaveTextContent("path: assets/a.pdb");
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
    expect(canvasContext().mock.calls.length).toBe(calls);
  });

  it("starts at once without IntersectionObserver and explains missing WebGL", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    stubWebgl(false);
    const element = preview();
    paintMolecule(element, XYZ, { still: false });
    expect(element).toHaveTextContent(copy.noWebgl);
  });

  it("waits until the block is visible, then mounts the viewer", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    stubWebgl(true);
    const element = preview();
    const dispose = paintMolecule(element, `style: line\n${XYZ}`, { still: false, fence: "molecule" });
    expect(element).toHaveTextContent(copy.loading);
    const [observer] = FakeObserver.instances;
    expect(observer.observed[0]).toBe(element.firstElementChild);
    act(() => observer.fire(false));
    expect(lib.viewers).toHaveLength(0);
    act(() => observer.fire(true));
    expect(observer.disconnected).toBe(true);
    await waitFor(() => expect(within(element).getByRole("combobox", { name: copy.style })).toHaveValue("line"));
    expect(lib.formats).toEqual(["xyz"]);
    dispose?.();
    await settle();
    expect(element.querySelector(".note-molecule")).toBeNull();
    expect(lib.viewers[0].clear).toHaveBeenCalled();
  });

  it("reads a file and uses its extension for the format", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
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
    vi.stubGlobal("IntersectionObserver", undefined);
    stubWebgl(true);
    const element = preview();
    paintMolecule(element, "path: assets/a.pdb", { still: false, readFile: async () => null });
    await waitFor(() => expect(element).toHaveTextContent("File not found: assets/a.pdb"));
    paintMolecule(element, "nothing to see", { still: false });
    await waitFor(() => expect(element).toHaveTextContent(copy.unknownFormat));
  });

  it("ignores results that arrive after dispose", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
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

  it("disconnects the observer on dispose", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const dispose = paintMolecule(preview(), XYZ, { still: false });
    dispose?.();
    expect(FakeObserver.instances[0].disconnected).toBe(true);
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

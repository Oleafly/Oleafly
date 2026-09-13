// @vitest-environment jsdom
import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  equationAtCursor,
  equationToSvgDocument,
  saveEquationAsPng,
  saveEquationAsSvg,
  svgDocumentToPngBytes,
} from "./equation-export";

const mocks = vi.hoisted(() => ({
  editor: vi.fn(),
  selection: vi.fn(),
  enclosing: vi.fn(),
  pickSavePath: vi.fn(),
  writeBytes: vi.fn(),
  reveal: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@oleafly/editor", () => ({ getEditorView: mocks.editor }));
vi.mock("@/components/editor/selection-text", () => ({ activeSelectionText: mocks.selection }));
vi.mock("@/components/editor/cm/hover-math", () => ({ enclosingMathEnvironment: mocks.enclosing }));
vi.mock("@/lib/tauri", () => ({ writeBytesFile: mocks.writeBytes, revealInDir: mocks.reveal }));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError, toast: { success: mocks.success, info: mocks.info } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.editor.mockReturnValue({ state: { doc: { toString: () => "Document with math" }, selection: { main: { head: 7 } } } });
  mocks.selection.mockReturnValue("x^2");
  mocks.enclosing.mockReturnValue(null);
  mocks.pickSavePath.mockResolvedValue("/exports/equation.svg");
  mocks.writeBytes.mockResolvedValue(undefined);
  mocks.reveal.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("equationToSvgDocument", () => {
  it("renders TeX to a standalone svg with paths", async () => {
    const svg = await equationToSvgDocument("E = mc^2", true);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("<path");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  }, 20_000);

  it("renders matrices and aligned systems", async () => {
    const aligned = await equationToSvgDocument(
      "\\begin{aligned} a &= b + c \\\\ d &= e \\end{aligned}",
      true,
    );
    expect(aligned).toContain("<path");
    const matrix = await equationToSvgDocument(
      "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}",
      true,
    );
    expect(matrix).toContain("<path");
  });

  it("rejects broken input with the MathJax error", async () => {
    await expect(equationToSvgDocument("\\begin{aligned}", true)).rejects.toThrow("MathJax could not render");
  });
});

describe("equationAtCursor", () => {
  it("has no export source without an editor", () => {
    mocks.editor.mockReturnValue(null);
    expect(equationAtCursor()).toBeNull();
    expect(mocks.selection).not.toHaveBeenCalled();
  });

  it.each([
    ["  $$ x + y $$  ", "x + y", true],
    [String.raw` \[ x + y \] `, "x + y", true],
    ["  x + y  ", "x + y", false],
  ])("extracts the selected source %s", (selection, tex, display) => {
    mocks.selection.mockReturnValue(selection);
    expect(equationAtCursor()).toEqual({ tex, display });
    expect(mocks.enclosing).not.toHaveBeenCalled();
  });

  it.each(["inline", "align"])("uses the caret's %s environment when the selection is empty", (environment) => {
    mocks.selection.mockReturnValue(" \n ");
    mocks.enclosing.mockReturnValue({ body: " x = y ", environment });
    expect(equationAtCursor()).toEqual({ tex: "x = y", display: environment !== "inline" });
    expect(mocks.enclosing).toHaveBeenCalledWith("Document with math", 7);
  });

  it("has no source outside an equation", () => {
    mocks.selection.mockReturnValue(null);
    expect(equationAtCursor()).toBeNull();
  });
});

const SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="10"></svg>';
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255, 0, 128]);

/** Stub the browser encoder while observing its drawing and cleanup contract. */
function rasterizer(options: {
  width?: number;
  height?: number;
  loadError?: boolean;
  noContext?: boolean;
  nullBlob?: boolean;
  drawError?: Error;
  encodeError?: Error;
  bytesError?: Error;
  bytes?: Uint8Array;
} = {}) {
  const createUrl = vi.fn((_blob: Blob | MediaSource) => "blob:equation-test");
  const revokeUrl = vi.fn();
  class ExportUrl extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = revokeUrl;
  }
  class ExportImage {
    width = options.width ?? 40;
    height = options.height ?? 10;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => options.loadError ? this.onerror?.() : this.onload?.());
    }
  }
  vi.stubGlobal("URL", ExportUrl);
  vi.stubGlobal("Image", ExportImage);
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  if (options.drawError) context.drawImage.mockImplementation(() => { throw options.drawError; });
  let canvas: HTMLCanvasElement | undefined;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    canvas = this;
    return options.noContext ? null : context as unknown as CanvasRenderingContext2D;
  });
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    if (options.encodeError) throw options.encodeError;
    callback(options.nullBlob ? null : {
      arrayBuffer: async () => {
        if (options.bytesError) throw options.bytesError;
        return (options.bytes ?? PNG_BYTES).slice().buffer;
      },
    } as Blob);
  });
  return { createUrl, revokeUrl, context, toBlob, canvas: () => canvas };
}

describe("svgDocumentToPngBytes", () => {
  it("scales the canvas and draws a requested background before the equation", async () => {
    const browser = rasterizer();
    expect(await svgDocumentToPngBytes(SVG_SOURCE, 2.25, "#ffffff")).toEqual(PNG_BYTES);
    expect(browser.canvas()).toMatchObject({ width: 90, height: 23 });
    expect(browser.context.fillStyle).toBe("#ffffff");
    expect(browser.context.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 90, 23);
    expect(browser.context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 90, 23);
    expect(browser.context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(browser.context.drawImage.mock.invocationCallOrder[0]);
    expect(browser.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(browser.createUrl.mock.calls[0][0]).toMatchObject({ type: "image/svg+xml" });
    expect(browser.revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:equation-test");
  });

  it("uses default dimensions and scale without painting a transparent background", async () => {
    const browser = rasterizer({ width: 0, height: 0 });
    await svgDocumentToPngBytes(SVG_SOURCE);
    expect(browser.canvas()).toMatchObject({ width: 900, height: 180 });
    expect(browser.context.fillRect).not.toHaveBeenCalled();
    expect(browser.context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 900, 180);
  });

  it("retains at least one pixel for a very small positive scale", async () => {
    const browser = rasterizer();
    await svgDocumentToPngBytes(SVG_SOURCE, 0.001);
    expect(browser.canvas()).toMatchObject({ width: 1, height: 1 });
  });

  it.each([
    [{ loadError: true }, "could not be rasterized"],
    [{ noContext: true }, "canvas is unavailable"],
    [{ nullBlob: true }, "could not be encoded"],
    [{ drawError: new Error("Drawing failed") }, "Drawing failed"],
    [{ encodeError: new Error("Encoding failed") }, "Encoding failed"],
    [{ bytesError: new Error("Blob read failed") }, "Blob read failed"],
  ] as const)("releases the temporary URL when rasterization fails (%s)", async (options, error) => {
    const browser = rasterizer(options);
    await expect(svgDocumentToPngBytes(SVG_SOURCE)).rejects.toThrow(error);
    expect(browser.revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:equation-test");
  });
});

describe("saving equations", () => {
  it.each([saveEquationAsSvg, saveEquationAsPng])("explains a missing source without opening a save picker", async (save) => {
    mocks.editor.mockReturnValue(null);
    await save();
    expect(mocks.info).toHaveBeenCalledWith("Put the caret inside an equation, or select one, first.");
    expect(mocks.pickSavePath).not.toHaveBeenCalled();
    expect(mocks.writeBytes).not.toHaveBeenCalled();
  });

  it("saves a standalone SVG and reveals the chosen file from the success action", async () => {
    mocks.selection.mockReturnValue("$$x^2$$");
    await saveEquationAsSvg();
    expect(mocks.pickSavePath).toHaveBeenCalledWith({ defaultPath: "equation.svg", filters: [{ name: "SVG image", extensions: ["svg"] }] });
    expect(mocks.writeBytes).toHaveBeenCalledOnce();
    const [path, encoded] = mocks.writeBytes.mock.calls[0];
    expect(path).toBe("/exports/equation.svg");
    const saved = Buffer.from(encoded, "base64").toString("utf8");
    expect(saved).toMatch(/^<svg[^>]*xmlns=/);
    expect(saved).toContain("<path");
    expect(saved.endsWith("</svg>")).toBe(true);
    expect(mocks.success).toHaveBeenCalledWith("Equation SVG saved", expect.objectContaining({ label: "Show in folder" }), true);
    mocks.success.mock.calls[0][1].onClick();
    await vi.waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith("/exports/equation.svg"));
  });

  it("saves exact PNG bytes across base64 chunk boundaries with the default white background", async () => {
    const bytes = Uint8Array.from({ length: 0x8000 + 19 }, (_, index) => index % 256);
    const browser = rasterizer({ bytes });
    mocks.pickSavePath.mockResolvedValue("/exports/equation.png");
    await saveEquationAsPng();
    expect(browser.context.fillStyle).toBe("#ffffff");
    expect(browser.canvas()).toMatchObject({ width: 120, height: 30 });
    expect(mocks.pickSavePath).toHaveBeenCalledWith({ defaultPath: "equation.png", filters: [{ name: "PNG image", extensions: ["png"] }] });
    expect(mocks.writeBytes).toHaveBeenCalledExactlyOnceWith("/exports/equation.png", Buffer.from(bytes).toString("base64"));
    expect(mocks.success).toHaveBeenCalledWith("Equation PNG saved", expect.anything(), true);
    expect(browser.revokeUrl).toHaveBeenCalledOnce();
  });

  it("supports PNG transparency and a custom export scale", async () => {
    const browser = rasterizer();
    await saveEquationAsPng(2, null);
    expect(browser.context.fillRect).not.toHaveBeenCalled();
    expect(browser.canvas()).toMatchObject({ width: 80, height: 20 });
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it.each([saveEquationAsSvg, saveEquationAsPng])("treats a cancelled save picker as a silent cancellation", async (save) => {
    const browser = rasterizer();
    mocks.pickSavePath.mockResolvedValue(null);
    await save();
    expect(mocks.writeBytes).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
    if (save === saveEquationAsPng) expect(browser.revokeUrl).toHaveBeenCalledOnce();
  });

  it.each([
    [saveEquationAsSvg, "export equation svg"],
    [saveEquationAsPng, "export equation png"],
  ] as const)("reports picker failure without writing (%s)", async (save, operation) => {
    rasterizer();
    const error = new Error("Save dialog unavailable");
    mocks.pickSavePath.mockRejectedValue(error);
    await save();
    expect(mocks.notifyError).toHaveBeenCalledExactlyOnceWith(operation, error);
    expect(mocks.writeBytes).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each([
    [saveEquationAsSvg, "export equation svg"],
    [saveEquationAsPng, "export equation png"],
  ] as const)("reports failed disk writes without claiming success (%s)", async (save, operation) => {
    const browser = rasterizer();
    const error = new Error("Disk is full");
    mocks.writeBytes.mockRejectedValue(error);
    await save();
    expect(mocks.notifyError).toHaveBeenCalledExactlyOnceWith(operation, error);
    expect(mocks.success).not.toHaveBeenCalled();
    if (save === saveEquationAsPng) expect(browser.revokeUrl).toHaveBeenCalledOnce();
  });

  it.each([
    [saveEquationAsSvg, "export equation svg"],
    [saveEquationAsPng, "export equation png"],
  ] as const)("rejects invalid TeX before asking for a destination (%s)", async (save, operation) => {
    mocks.selection.mockReturnValue("\\begin{aligned}");
    await save();
    expect(mocks.notifyError).toHaveBeenCalledWith(operation, expect.any(Error));
    expect(mocks.pickSavePath).not.toHaveBeenCalled();
    expect(mocks.writeBytes).not.toHaveBeenCalled();
  });

  it("reports rasterization failure before showing the PNG save picker", async () => {
    const browser = rasterizer({ loadError: true });
    await saveEquationAsPng();
    expect(mocks.notifyError).toHaveBeenCalledWith("export equation png", expect.any(Error));
    expect(mocks.pickSavePath).not.toHaveBeenCalled();
    expect(browser.revokeUrl).toHaveBeenCalledOnce();
  });
});

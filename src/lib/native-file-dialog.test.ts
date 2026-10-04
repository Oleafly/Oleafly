// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  pickTableImportFile: vi.fn(),
  registerPickedFileForE2E: vi.fn(),
  e2eHooks: true,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: mocks.save }));
vi.mock("@/lib/tauri", () => ({
  pickTableImportFile: mocks.pickTableImportFile,
  registerPickedFileForE2E: mocks.registerPickedFileForE2E,
}));
vi.mock("@/lib/e2e-flags", () => ({
  get E2E_HOOKS() {
    return mocks.e2eHooks;
  },
}));

async function load() {
  vi.resetModules();
  return import("./native-file-dialog");
}

beforeEach(() => {
  mocks.e2eHooks = true;
  delete window.__e2eFileDialogState;
  delete window.__e2eSetNextImportPaths;
  delete window.__e2eSetNextSavePath;
  mocks.open.mockReset().mockResolvedValue("/native/open.tex");
  mocks.save.mockReset().mockResolvedValue("/native/save.pdf");
  mocks.pickTableImportFile.mockReset().mockResolvedValue("/native/table.csv");
  mocks.registerPickedFileForE2E.mockReset().mockImplementation(async (path: string) => `registered:${path}`);
});

afterEach(() => {
  delete window.__e2eFileDialogState;
});

describe("pickOpenPath", () => {
  it("uses the native dialog when no e2e path is queued and counts the request", async () => {
    const { pickOpenPath } = await load();
    await expect(pickOpenPath({ multiple: false })).resolves.toBe("/native/open.tex");
    expect(mocks.open).toHaveBeenCalledWith({ multiple: false });
    expect(window.__e2eFileDialogState?.openRequests).toBe(1);
  });

  it("returns a queued path once, shaped by the dialog options", async () => {
    const { pickOpenPath } = await load();
    window.__e2eSetNextImportPaths?.(["/a.tex", "/b.tex"]);
    await expect(pickOpenPath({ multiple: true })).resolves.toEqual(["/a.tex", "/b.tex"]);

    window.__e2eSetNextImportPaths?.(["/dir", "/other"]);
    await expect(pickOpenPath({ directory: true })).resolves.toBe("/dir");

    window.__e2eSetNextImportPaths?.(["/single.tex", "/ignored.tex"]);
    await expect(pickOpenPath()).resolves.toBe("/single.tex");

    await expect(pickOpenPath()).resolves.toBe("/native/open.tex");
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(window.__e2eFileDialogState?.openRequests).toBe(4);
  });

  it("returns null for a queued cancellation or an empty queued list", async () => {
    const { pickOpenPath } = await load();
    window.__e2eSetNextImportPaths?.(null);
    await expect(pickOpenPath({ multiple: true })).resolves.toBeNull();

    window.__e2eSetNextImportPaths?.([]);
    await expect(pickOpenPath({ directory: true })).resolves.toBeNull();

    window.__e2eSetNextImportPaths?.([]);
    await expect(pickOpenPath()).resolves.toBeNull();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("copies the queued list so later caller mutations do not leak in", async () => {
    const { pickOpenPath } = await load();
    const paths = ["/a.tex"];
    window.__e2eSetNextImportPaths?.(paths);
    paths.push("/b.tex");
    await expect(pickOpenPath({ multiple: true })).resolves.toEqual(["/a.tex"]);
  });

  it("always uses the native dialog when e2e hooks are off", async () => {
    mocks.e2eHooks = false;
    const { pickOpenPath, pickSavePath, pickTableImportPath } = await load();
    expect(window.__e2eSetNextImportPaths).toBeUndefined();
    await expect(pickOpenPath()).resolves.toBe("/native/open.tex");
    await expect(pickSavePath()).resolves.toBe("/native/save.pdf");
    await expect(pickTableImportPath()).resolves.toBe("/native/table.csv");
    expect(window.__e2eFileDialogState).toBeUndefined();
  });
});

describe("pickTableImportPath", () => {
  it("falls through to the native table picker", async () => {
    const { pickTableImportPath } = await load();
    await expect(pickTableImportPath()).resolves.toBe("/native/table.csv");
    expect(window.__e2eFileDialogState?.openRequests).toBe(1);
  });

  it("registers the first queued path with the backend", async () => {
    const { pickTableImportPath } = await load();
    window.__e2eSetNextImportPaths?.(["/data/t.csv", "/data/u.csv"]);
    await expect(pickTableImportPath()).resolves.toBe("registered:/data/t.csv");
    expect(mocks.registerPickedFileForE2E).toHaveBeenCalledWith("/data/t.csv");
    expect(mocks.pickTableImportFile).not.toHaveBeenCalled();
  });

  it("returns null for a queued cancellation without registering anything", async () => {
    const { pickTableImportPath } = await load();
    window.__e2eSetNextImportPaths?.(null);
    await expect(pickTableImportPath()).resolves.toBeNull();
    window.__e2eSetNextImportPaths?.([]);
    await expect(pickTableImportPath()).resolves.toBeNull();
    expect(mocks.registerPickedFileForE2E).not.toHaveBeenCalled();
  });
});

describe("pickSavePath", () => {
  it("uses the native save dialog when nothing is queued", async () => {
    const { pickSavePath } = await load();
    await expect(pickSavePath({ defaultPath: "out.pdf" })).resolves.toBe("/native/save.pdf");
    expect(mocks.save).toHaveBeenCalledWith({ defaultPath: "out.pdf" });
    expect(window.__e2eFileDialogState?.saveRequests).toBe(1);
  });

  it("returns a queued save path once, including a queued cancellation", async () => {
    const { pickSavePath } = await load();
    window.__e2eSetNextSavePath?.("/tmp/export.pdf");
    await expect(pickSavePath()).resolves.toBe("/tmp/export.pdf");
    window.__e2eSetNextSavePath?.(null);
    await expect(pickSavePath()).resolves.toBeNull();
    await expect(pickSavePath()).resolves.toBe("/native/save.pdf");
    expect(window.__e2eFileDialogState?.saveRequests).toBe(3);
  });
});

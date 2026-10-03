import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setTypstProjectOptions: vi.fn(async (_projectId: string, _update: unknown) => ({})),
  refreshEngine: vi.fn(async () => {}),
  recompile: vi.fn(async () => {}),
  select: vi.fn(),
  errorUnique: vi.fn(),
  logError: vi.fn(),
  watcher: { value: false },
  projectId: { value: "p1" as string | null },
}));

vi.mock("@/lib/typst-options", () => ({ setTypstProjectOptions: mocks.setTypstProjectOptions }));
vi.mock("@/store/files", () => ({
  engineSwitchToastKey: (projectId: string) => `engine-switch:${projectId}`,
  useFilesStore: { getState: () => ({ projectId: mocks.projectId.value, refreshEngine: mocks.refreshEngine }) },
}));
vi.mock("@/store/compile", () => ({
  typstLivePreviewWanted: () => mocks.watcher.value,
  useCompileStore: { getState: () => ({ recompile: mocks.recompile }) },
}));
vi.mock("@/store/typst-variant", () => ({ useTypstVariantStore: { getState: () => ({ select: mocks.select }) } }));
vi.mock("@/lib/toast", () => ({ toast: { errorUnique: mocks.errorUnique } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { applyTypstCompileOptions, chooseTypstVariant } from "./typst-compile-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.watcher.value = false;
  mocks.projectId.value = "p1";
});

describe("Typst compile choices from the compile menu", () => {
  it("saves the choice, reloads the engine and compiles once", async () => {
    await applyTypstCompileOptions({ systemFonts: false });
    expect(mocks.setTypstProjectOptions).toHaveBeenCalledExactlyOnceWith("p1", { systemFonts: false });
    expect(mocks.refreshEngine).toHaveBeenCalledOnce();
    expect(mocks.recompile).toHaveBeenCalledOnce();
  });

  it("leaves the compile to the Typst watcher while auto compile drives it", async () => {
    mocks.watcher.value = true;
    await applyTypstCompileOptions({ reproducible: true });
    expect(mocks.refreshEngine).toHaveBeenCalledOnce();
    expect(mocks.recompile).not.toHaveBeenCalled();
  });

  it("names the setting that could not be saved", async () => {
    mocks.setTypstProjectOptions.mockRejectedValueOnce(new Error("disk full"));
    await applyTypstCompileOptions({ systemFonts: true });
    expect(mocks.errorUnique).toHaveBeenLastCalledWith("engine-switch:p1", enShell.compile.typstFonts.saveFailed);
    mocks.setTypstProjectOptions.mockRejectedValueOnce(new Error("disk full"));
    await applyTypstCompileOptions({ reproducible: true });
    expect(mocks.errorUnique).toHaveBeenLastCalledWith("engine-switch:p1", enShell.compile.typstBuild.saveFailed);
    expect(mocks.recompile).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledTimes(2);
  });

  it("does nothing without an open project", async () => {
    mocks.projectId.value = null;
    await applyTypstCompileOptions({ systemFonts: false });
    chooseTypstVariant("draft");
    expect(mocks.setTypstProjectOptions).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("picks a variant and compiles unless the watcher picks it up", () => {
    chooseTypstVariant("draft");
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith("p1", "draft");
    expect(mocks.recompile).toHaveBeenCalledOnce();
    mocks.watcher.value = true;
    chooseTypstVariant(null);
    expect(mocks.select).toHaveBeenLastCalledWith("p1", null);
    expect(mocks.recompile).toHaveBeenCalledOnce();
  });
});

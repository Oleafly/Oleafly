import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  engine: {
    installing: false,
    info: null as { latexmk_blocker?: { code: string; params: Record<string, string> } | null } | null,
  },
  files: {
    projectId: "paper" as string | null,
    engine: { id: "latexmk" },
    setShellEscape: vi.fn(async (_allow: boolean) => {}),
  },
  compileBusy: false,
  stopCompile: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  openPicker: vi.fn(),
}));

vi.mock("@/store/engine", () => ({
  useEngineStore: { getState: () => ({ ...mocks.engine, refresh: mocks.refresh }) },
}));
vi.mock("@/store/engine-picker", () => ({
  useEnginePickerStore: { getState: () => ({ openPicker: mocks.openPicker }) },
}));
vi.mock("@/store/files", () => ({
  engineSwitchToastKey: (projectId: string) => `engine-switch:${projectId}`,
  useFilesStore: { getState: () => mocks.files },
}));
vi.mock("@/lib/compile-preview", () => ({ recompileWithPreview: vi.fn() }));
vi.mock("@/store/compile", () => ({
  compileIsBusy: () => mocks.compileBusy,
  useCompileStore: { getState: () => ({ stopCompile: mocks.stopCompile }) },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { errorUnique: vi.fn() } }));

import { applyShellEscape, offerTexSetupAfterSwitch } from "./latex-compile-actions";

const blocked = { latexmk_blocker: { code: "tex.latexmk_missing", params: {} } };

beforeEach(() => {
  mocks.engine.installing = false;
  mocks.engine.info = null;
  mocks.files.projectId = "paper";
  mocks.files.engine = { id: "latexmk" };
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.openPicker.mockReset();
  mocks.compileBusy = false;
  mocks.stopCompile.mockReset().mockResolvedValue(undefined);
  mocks.files.setShellEscape.mockReset().mockResolvedValue(undefined);
});

describe("applyShellEscape", () => {
  it("stops a running compile before it turns code off", async () => {
    mocks.compileBusy = true;
    mocks.files.setShellEscape.mockImplementation(async () => {
      expect(mocks.stopCompile).toHaveBeenCalledOnce();
    });
    await expect(applyShellEscape(false)).resolves.toBe(true);
    expect(mocks.files.setShellEscape).toHaveBeenCalledWith(false);
  });

  it("leaves a running compile alone when code is turned on", async () => {
    mocks.compileBusy = true;
    await applyShellEscape(true);
    expect(mocks.stopCompile).not.toHaveBeenCalled();
  });

  it("joins a repeated click and runs the opposite one after the change in flight", async () => {
    const finishes: (() => void)[] = [];
    mocks.files.setShellEscape.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishes.push(resolve);
        }),
    );
    const first = applyShellEscape(true);
    expect(applyShellEscape(true)).toBe(first);
    const second = applyShellEscape(false);
    expect(second).not.toBe(first);
    expect(applyShellEscape(false)).toBe(second);
    await vi.waitFor(() => expect(mocks.files.setShellEscape).toHaveBeenCalledOnce());
    finishes[0]();
    await first;
    await vi.waitFor(() => expect(mocks.files.setShellEscape).toHaveBeenCalledTimes(2));
    finishes[1]();
    await second;
    expect(mocks.files.setShellEscape.mock.calls.map(([allow]) => allow)).toEqual([true, false]);
  });
});

describe("offerTexSetupAfterSwitch", () => {
  it("opens the picker when a fresh probe finds no usable latexmk", async () => {
    mocks.refresh.mockImplementation(async () => {
      mocks.engine.info = blocked;
    });
    await offerTexSetupAfterSwitch();
    expect(mocks.openPicker).toHaveBeenCalledExactlyOnceWith("tex-missing", []);
  });

  it("searches for TeX again instead of trusting the cached PATH", async () => {
    await offerTexSetupAfterSwitch();
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({ rescan: "full" });
  });

  it("stays quiet when latexmk is usable, even if the cached info said otherwise", async () => {
    mocks.engine.info = blocked;
    mocks.refresh.mockImplementation(async () => {
      mocks.engine.info = { latexmk_blocker: null };
    });
    await offerTexSetupAfterSwitch();
    expect(mocks.openPicker).not.toHaveBeenCalled();
  });

  it("does not interrupt a TinyTeX install that is already running", async () => {
    mocks.engine.installing = true;
    mocks.engine.info = blocked;
    await offerTexSetupAfterSwitch();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.openPicker).not.toHaveBeenCalled();
  });

  it("drops the offer when the project moved on during the probe", async () => {
    mocks.refresh.mockImplementation(async () => {
      mocks.engine.info = blocked;
      mocks.files.engine = { id: "latex" };
    });
    await offerTexSetupAfterSwitch();
    expect(mocks.openPicker).not.toHaveBeenCalled();

    mocks.files.engine = { id: "latexmk" };
    mocks.refresh.mockImplementation(async () => {
      mocks.files.projectId = "other";
    });
    await offerTexSetupAfterSwitch();
    expect(mocks.openPicker).not.toHaveBeenCalled();
  });
});

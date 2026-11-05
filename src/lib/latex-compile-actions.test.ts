import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  engine: {
    installing: false,
    info: null as { latexmk_blocker?: { code: string; params: Record<string, string> } | null } | null,
  },
  files: { projectId: "paper" as string | null, engine: { id: "latexmk" } },
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
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { errorUnique: vi.fn() } }));

import { offerTexSetupAfterSwitch } from "./latex-compile-actions";

const blocked = { latexmk_blocker: { code: "tex.latexmk_missing", params: {} } };

beforeEach(() => {
  mocks.engine.installing = false;
  mocks.engine.info = null;
  mocks.files.projectId = "paper";
  mocks.files.engine = { id: "latexmk" };
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.openPicker.mockReset();
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

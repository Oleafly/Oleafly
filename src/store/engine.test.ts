import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.error, info: mocks.info, success: mocks.success },
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { installPhaseLabel, useEngineStore } from "./engine";

const engine = {
  kind: "system" as const,
  lualatex: "/test/lualatex",
  tlmgr: "/test/tlmgr",
  latexmk: "/test/latexmk",
  version: "test",
};

function trees(system: string[], user: string[]) {
  mocks.invoke.mockImplementation(async (command: string, args?: { userTree?: boolean }) => {
    if (command === "latex_engine_info") return engine;
    if (command === "tlmgr_installed") return args?.userTree ? user : system;
    if (command === "tlmgr_remove") return "";
    return null;
  });
}

describe("installPhaseLabel", () => {
  it("shows the download percentage when the total size is known", () => {
    expect(installPhaseLabel("download", 42)).toBe(
      enCore.tinytex.phase.downloadingPercent.replace("{{progress}}", "42"),
    );
  });

  it("shows a plain downloading label when the size is unknown", () => {
    expect(installPhaseLabel("download", null)).toBe(enCore.tinytex.phase.downloading);
  });

  it("labels the extract phase", () => {
    expect(installPhaseLabel("extract", null)).toBe(enCore.tinytex.phase.unpacking);
  });

  it("labels the packages phase", () => {
    expect(installPhaseLabel("packages", null)).toBe(enCore.tinytex.phase.addingPackages);
  });

  it("falls back to a generic label when idle", () => {
    expect(installPhaseLabel(null, null)).toBe(enCore.tinytex.phase.installing);
  });
});

describe("package tree membership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEngineStore.setState({
      info: engine,
      installed: [],
      userInstalled: [],
      systemInstalled: [],
      busyPkg: null,
      packageError: null,
      packageNotice: null,
    });
  });

  it("keeps a package that lives in both trees in the personal-tree list", async () => {
    trees(["pgf", "tools"], ["pgf"]);
    await useEngineStore.getState().refreshPackages();
    const state = useEngineStore.getState();
    expect(state.userInstalled).toEqual(["pgf"]);
    expect(state.systemInstalled).toEqual(["pgf", "tools"]);
    expect(state.installed).toEqual(["pgf", "tools"]);
  });

  it("removes the personal copy first and the system copy on a second removal", async () => {
    trees(["pgf", "tools"], ["pgf"]);
    await useEngineStore.getState().refreshPackages();

    trees(["pgf", "tools"], []);
    await useEngineStore.getState().removePackage("pgf");
    expect(mocks.invoke).toHaveBeenCalledWith("tlmgr_remove", {
      packages: ["pgf"],
      userTree: true,
    });
    expect(useEngineStore.getState().userInstalled).toEqual([]);

    mocks.invoke.mockClear();
    await useEngineStore.getState().removePackage("pgf");
    expect(mocks.invoke).toHaveBeenCalledWith("tlmgr_remove", { packages: ["pgf"] });
  });

  it("targets the system tree for a package that only lives there", async () => {
    trees(["tools"], []);
    await useEngineStore.getState().refreshPackages();
    await useEngineStore.getState().removePackage("tools");
    expect(mocks.invoke).toHaveBeenCalledWith("tlmgr_remove", { packages: ["tools"] });
  });

  it("clears both tree lists when the package read fails", async () => {
    trees(["pgf"], []);
    await useEngineStore.getState().refreshPackages();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "latex_engine_info") return engine;
      if (command === "tlmgr_installed") throw new Error("tlmgr is not readable");
      return null;
    });
    await useEngineStore.getState().refreshPackages();
    const state = useEngineStore.getState();
    expect(state.userInstalled).toEqual([]);
    expect(state.systemInstalled).toEqual([]);
    expect(state.packageError).toMatchObject({ kind: "read", detail: "tlmgr is not readable" });
  });
});

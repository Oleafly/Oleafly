import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  infoUnique: vi.fn(),
  successUnique: vi.fn(),
  errorUnique: vi.fn(),
  logError: vi.fn(),
  stopRunningCompileQuietly: vi.fn(() => false),
  recompile: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/lib/toast", () => ({
  toast: {
    error: mocks.error,
    info: mocks.info,
    success: mocks.success,
    infoUnique: mocks.infoUnique,
    successUnique: mocks.successUnique,
    errorUnique: mocks.errorUnique,
  },
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/store/compile", () => ({
  installerNotices: (outcome: string) =>
    outcome
      .split("\n")
      .filter((line) => line.startsWith("[Oleafly] "))
      .map((line) => line.slice("[Oleafly] ".length)),
  stopRunningCompileQuietly: mocks.stopRunningCompileQuietly,
  useCompileStore: { getState: () => ({ recompile: mocks.recompile }) },
}));

import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { installPhaseLabel, TINYTEX_INSTALL_TOAST_KEY, useEngineStore } from "./engine";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function expectNoPlainToasts(): void {
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
  expect(mocks.info).not.toHaveBeenCalled();
}

describe("TinyTeX install and removal notices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stopRunningCompileQuietly.mockReturnValue(false);
    useEngineStore.setState({
      info: null,
      installing: false,
      removing: false,
      installPhase: null,
      progress: null,
      partialDownloadBytes: 0,
      compileQueuedDuringInstall: false,
      compileQueuedExplicitly: false,
      installWaitNoticeOpen: false,
      installWaitNoticeShown: false,
    });
  });

  it("claims the install before its first await so a second click cannot start another", async () => {
    const install = deferred<typeof engine>();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "install_tinytex") return install.promise;
      if (command === "tlmgr_installed") return [];
      return null;
    });
    const first = useEngineStore.getState().install();
    expect(useEngineStore.getState().installing).toBe(true);
    const second = useEngineStore.getState().install();
    await vi.waitFor(() =>
      expect(mocks.invoke.mock.calls.filter(([command]) => command === "install_tinytex")).toHaveLength(1),
    );
    install.resolve(engine);
    await Promise.all([first, second]);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "install_tinytex")).toHaveLength(1);
    expect(mocks.successUnique).toHaveBeenCalledExactlyOnceWith(
      TINYTEX_INSTALL_TOAST_KEY,
      enCore.tinytex.installed,
    );
    expectNoPlainToasts();
  });

  it("reports a failed install in the same notice slot", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "install_tinytex") throw new Error("The download stopped. Progress was kept.");
      if (command === "tinytex_install_state") return { installing: false, partial_download_bytes: 5 };
      return null;
    });
    await useEngineStore.getState().install();
    expect(mocks.errorUnique).toHaveBeenCalledExactlyOnceWith(
      TINYTEX_INSTALL_TOAST_KEY,
      "The download stopped. Progress was kept.",
      expect.objectContaining({ label: enCore.tinytex.installGuide }),
    );
    expect(useEngineStore.getState().partialDownloadBytes).toBe(5);
    expectNoPlainToasts();
  });

  it("pauses a running compile quietly and runs it once the install lands", async () => {
    mocks.stopRunningCompileQuietly.mockReturnValue(true);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "install_tinytex") return engine;
      if (command === "tlmgr_installed") return [];
      return null;
    });
    await useEngineStore.getState().install();
    expect(mocks.stopRunningCompileQuietly).toHaveBeenCalledOnce();
    expect(mocks.recompile).toHaveBeenCalledExactlyOnceWith({ origin: "explicit" });
    expect(useEngineStore.getState()).toMatchObject({
      compileQueuedDuringInstall: false,
      installWaitNoticeOpen: false,
    });
    expectNoPlainToasts();
  });

  it("opens the still-downloading notice once per install however many compiles queue", async () => {
    const install = deferred<typeof engine>();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "install_tinytex") return install.promise;
      if (command === "tlmgr_installed") return [];
      return null;
    });
    const running = useEngineStore.getState().install();
    useEngineStore.getState().queueCompileAfterInstall();
    expect(useEngineStore.getState().installWaitNoticeOpen).toBe(true);
    useEngineStore.getState().closeInstallWaitNotice();
    for (let attempt = 0; attempt < 5; attempt++) {
      useEngineStore.getState().queueCompileAfterInstall();
    }
    expect(useEngineStore.getState()).toMatchObject({
      installWaitNoticeOpen: false,
      compileQueuedDuringInstall: true,
    });
    install.resolve(engine);
    await running;
    expect(mocks.recompile).toHaveBeenCalledExactlyOnceWith({ origin: "explicit" });

    const next = deferred<typeof engine>();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "install_tinytex") return next.promise;
      if (command === "tlmgr_installed") return [];
      return null;
    });
    const again = useEngineStore.getState().install();
    useEngineStore.getState().queueCompileAfterInstall();
    expect(useEngineStore.getState().installWaitNoticeOpen).toBe(true);
    next.resolve(engine);
    await again;
  });

  it("queues an automatic compile silently and runs it as automatic once the install lands", async () => {
    const install = deferred<typeof engine>();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "install_tinytex") return install.promise;
      if (command === "tlmgr_installed") return [];
      return null;
    });
    const running = useEngineStore.getState().install();
    useEngineStore.getState().queueCompileAfterInstall("automatic");
    expect(useEngineStore.getState()).toMatchObject({
      installWaitNoticeOpen: false,
      compileQueuedDuringInstall: true,
    });
    install.resolve(engine);
    await running;
    expect(mocks.recompile).toHaveBeenCalledExactlyOnceWith({ origin: "automatic" });
  });

  it("clears a notice left open by a failed install when the next install starts", async () => {
    useEngineStore.setState({ installWaitNoticeOpen: true, installWaitNoticeShown: true });
    const install = deferred<typeof engine>();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "install_tinytex") return install.promise;
      if (command === "tlmgr_installed") return [];
      return null;
    });
    const running = useEngineStore.getState().install();
    expect(useEngineStore.getState().installWaitNoticeOpen).toBe(false);
    install.resolve(engine);
    await running;
  });

  it("removes TinyTeX once per click burst and reports the outcome in one slot", async () => {
    const removal = deferred<void>();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "delete_tinytex") return removal.promise;
      if (command === "latex_engine_info") return engine;
      return null;
    });
    const first = useEngineStore.getState().remove();
    expect(useEngineStore.getState().removing).toBe(true);
    await useEngineStore.getState().remove();
    removal.resolve();
    await first;
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "delete_tinytex")).toHaveLength(1);
    expect(mocks.successUnique).toHaveBeenCalledExactlyOnceWith("tinytex-remove", enCore.tinytex.removed);
    expect(useEngineStore.getState().removing).toBe(false);
    expectNoPlainToasts();

    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "delete_tinytex") throw new Error("compile running");
      return null;
    });
    await useEngineStore.getState().remove();
    expect(mocks.errorUnique).toHaveBeenCalledExactlyOnceWith(
      "tinytex-remove",
      enCore.tinytex.removeFailed,
    );
    expect(mocks.logError).toHaveBeenCalledWith("delete tinytex", expect.any(Error));
    expect(useEngineStore.getState().removing).toBe(false);
  });
});

describe("package toggles in Settings", () => {
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

  it("keeps the installer notice inline instead of a toast", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "tlmgr_install") {
        return "[Oleafly] The system TeX tree is not writable, so the packages went into your personal tree at /home/u/texmf.\ntlmgr: done";
      }
      if (command === "tlmgr_installed") return [];
      return null;
    });
    await useEngineStore.getState().addPackage("pgf");
    expect(useEngineStore.getState().packageNotice).toContain("personal tree at /home/u/texmf");
    expectNoPlainToasts();
  });

  it("keeps install and removal failures inline instead of a toast", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "tlmgr_install") throw new Error("no such package");
      if (command === "tlmgr_remove") throw new Error("package is required");
      return null;
    });
    await useEngineStore.getState().addPackage("nope");
    expect(useEngineStore.getState().packageError).toMatchObject({
      kind: "install",
      name: "nope",
      detail: "no such package",
    });
    await useEngineStore.getState().removePackage("tools");
    expect(useEngineStore.getState().packageError).toMatchObject({
      kind: "remove",
      name: "tools",
      detail: "package is required",
    });
    expect(mocks.logError).toHaveBeenCalledTimes(2);
    expectNoPlainToasts();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });
});

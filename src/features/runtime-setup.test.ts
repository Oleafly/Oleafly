import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotebookToolchainStatus } from "@/lib/notebook-commands";

const mocks = vi.hoisted(() => ({
  recompile: vi.fn(async () => undefined),
  openSettings: vi.fn(),
  store: {
    status: null as NotebookToolchainStatus | null,
    awaitingInstaller: [] as string[],
    installRuntime: vi.fn(async () => true),
    installRuntimePackages: vi.fn(async () => true),
    recheck: vi.fn(async (): Promise<NotebookToolchainStatus | null> => null),
    ensureLoaded: vi.fn(async (): Promise<NotebookToolchainStatus | null> => null),
  },
  projectId: "p1" as string | null,
}));

vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => ({ recompile: mocks.recompile }) } }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => ({ projectId: mocks.projectId }) } }));
vi.mock("@/store/notebook-toolchain", () => ({
  openNotebookToolSettings: mocks.openSettings,
  runtimeIn: (status: NotebookToolchainStatus | null, name: string) => status?.runtimes.find((runtime) => runtime.name === name),
  useNotebookToolchainStore: { getState: () => mocks.store },
}));

import { acceptRuntimeNeed } from "./runtime-setup";

function withR(path: string | null, installer = true): NotebookToolchainStatus {
  return {
    quarto: {} as never,
    calepin: {} as never,
    runtimes: [{ name: "r", path, version: null, installer: installer ? { version: "4.6.2", downloadBytes: 1 } : null }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectId = "p1";
  mocks.store.status = null;
  mocks.store.awaitingInstaller = [];
});

describe("acceptRuntimeNeed", () => {
  it("installs packages and compiles again while the project is still open", async () => {
    await acceptRuntimeNeed("p1", { kind: "packages", runtime: "python", packages: ["pandas"] });
    expect(mocks.store.installRuntimePackages).toHaveBeenCalledWith("python", ["pandas"], "p1");
    expect(mocks.recompile).toHaveBeenCalledOnce();
    mocks.projectId = "other";
    await acceptRuntimeNeed("p1", { kind: "packages", runtime: "r", packages: ["knitr"] });
    expect(mocks.recompile).toHaveBeenCalledOnce();
  });

  it("downloads the installer, then checks again and compiles once R is found", async () => {
    mocks.store.ensureLoaded.mockResolvedValue(withR(null));
    await acceptRuntimeNeed("p1", { kind: "runtime", runtime: "r" });
    expect(mocks.store.installRuntime).toHaveBeenCalledWith("r");
    mocks.store.awaitingInstaller = ["r"];
    mocks.store.recheck.mockResolvedValueOnce(withR(null)).mockResolvedValueOnce(withR("/usr/local/bin/Rscript"));
    await acceptRuntimeNeed("p1", { kind: "runtime", runtime: "r" });
    expect(mocks.recompile).not.toHaveBeenCalled();
    await acceptRuntimeNeed("p1", { kind: "runtime", runtime: "r" });
    expect(mocks.recompile).toHaveBeenCalledOnce();
  });

  it("opens the engine settings where there is no installer to download", async () => {
    mocks.store.status = withR(null, false);
    await acceptRuntimeNeed("p1", { kind: "runtime", runtime: "r" });
    expect(mocks.openSettings).toHaveBeenCalledWith("quarto");
    expect(mocks.store.installRuntime).not.toHaveBeenCalled();
  });
});

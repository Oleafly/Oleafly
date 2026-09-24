// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reportFileSaveFailure: vi.fn(),
  logError: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    errorUnique: vi.fn(),
    infoUnique: vi.fn(),
  },
  notifyError: vi.fn(),
}));

vi.mock("@/store/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/files")>()),
  reportFileSaveFailure: mocks.reportFileSaveFailure,
}));
vi.mock("@oleafly/latex-intelligence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/latex-intelligence")>()),
  loadCore: async () => null,
  loadAtSuggestions: async () => null,
  loadPackageNames: async () => null,
  loadClassNames: async () => null,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast, notifyError: mocks.notifyError }));

import { useFilesStore } from "@/store/files";
import { saveActiveFromKeymap } from "./CodeMirrorEditor";

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function expectNoDirectNotice(): void {
  for (const notify of Object.values(mocks.toast)) expect(notify).not.toHaveBeenCalled();
  expect(mocks.notifyError).not.toHaveBeenCalled();
}

describe("saveActiveFromKeymap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands a failed keymap save to the shared save notice for that file", async () => {
    const failure = new Error("disk full");
    const saveActive = vi.fn().mockRejectedValue(failure);
    useFilesStore.setState({ projectId: "p1", activePath: "main.tex", saveActive } as never);

    saveActiveFromKeymap();
    await settle();

    expect(saveActive).toHaveBeenCalledOnce();
    expect(mocks.reportFileSaveFailure).toHaveBeenCalledOnce();
    expect(mocks.reportFileSaveFailure).toHaveBeenCalledWith("editor save", "p1", "main.tex", failure, true);
    expectNoDirectNotice();
  });

  it("reports against the file that was saved even if the user switched tabs", async () => {
    const failure = new Error("disk full");
    let reject!: (error: unknown) => void;
    const saveActive = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    useFilesStore.setState({ projectId: "p1", activePath: "main.tex", saveActive } as never);

    saveActiveFromKeymap();
    useFilesStore.setState({ activePath: "intro.tex" } as never);
    reject(failure);
    await settle();

    expect(mocks.reportFileSaveFailure).toHaveBeenCalledWith("editor save", "p1", "main.tex", failure, true);
  });

  it("only logs when no file is open", async () => {
    const failure = new Error("no project");
    const saveActive = vi.fn().mockRejectedValue(failure);
    useFilesStore.setState({ projectId: null, activePath: null, saveActive } as never);

    saveActiveFromKeymap();
    await settle();

    expect(mocks.reportFileSaveFailure).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("editor save", failure);
    expectNoDirectNotice();
  });

  it("stays quiet when the save succeeds", async () => {
    const saveActive = vi.fn().mockResolvedValue(undefined);
    useFilesStore.setState({ projectId: "p1", activePath: "main.tex", saveActive } as never);

    saveActiveFromKeymap();
    await settle();

    expect(mocks.reportFileSaveFailure).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
    expectNoDirectNotice();
  });
});

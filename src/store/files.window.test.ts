// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeFileContent: vi.fn(),
  projectMutationGeneration: vi.fn(),
  gitLog: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  writeFileContent: mocks.writeFileContent,
  projectMutationGeneration: mocks.projectMutationGeneration,
  gitLog: mocks.gitLog,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { useProjectAvailabilityStore } from "@/store/project-availability";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "./files";

const commitCount = () =>
  (window as unknown as { __gitCommitCount: () => Promise<number> }).__gitCommitCount();

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.projectMutationGeneration.mockResolvedValue(4);
  mocks.writeFileContent.mockImplementation(async (_projectId: string, path: string) => ({ path, generation: 5 }));
  useProjectAvailabilityStore.getState().reset("project");
  useFilesStore.setState({
    projectId: "project",
    projectDictionaryLocale: null,
    files: {
      "main.tex": { content: "unsaved", dirty: true },
      "refs.bib": { content: "saved", dirty: false },
    },
  });
});

afterEach(() => {
  useFilesStore.setState({ projectId: null, files: {}, projectDictionaryLocale: null });
});

describe("leaving the window", () => {
  it("saves every unsaved file right away when the page hides", async () => {
    window.dispatchEvent(new Event("pagehide"));

    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(1));
    expect(mocks.writeFileContent.mock.calls[0].slice(0, 3)).toEqual(["project", "main.tex", "unsaved"]);
  });

  it("saves before the window unloads", async () => {
    window.dispatchEvent(new Event("beforeunload"));

    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(1));
    expect(mocks.writeFileContent.mock.calls[0].slice(0, 3)).toEqual(["project", "main.tex", "unsaved"]);
  });

  it("writes nothing while the project folder is unavailable", async () => {
    useProjectAvailabilityStore.getState().report("project", "missing");

    window.dispatchEvent(new Event("pagehide"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });
});

describe("commit count test hook", () => {
  it("counts the open project's commits", async () => {
    mocks.gitLog.mockResolvedValue([{ oid: "a" }, { oid: "b" }]);

    await expect(commitCount()).resolves.toBe(2);
    expect(mocks.gitLog).toHaveBeenCalledWith("project");
  });

  it("reports no commits without a project or when the log cannot be read", async () => {
    mocks.gitLog.mockRejectedValue(new Error("not a repository"));
    await expect(commitCount()).resolves.toBe(0);

    useFilesStore.setState({ projectId: null });
    await expect(commitCount()).resolves.toBe(0);
  });
});

describe("project dictionary language", () => {
  it("tells the proofreader when the project's own dictionary language changes", () => {
    useSettingsStore.setState({ dictionaryLocale: "en_US" });
    const changed = vi.fn();
    window.addEventListener("oleafly:proofreading-settings-changed", changed);

    useFilesStore.setState({ projectDictionaryLocale: "de_DE" });
    useFilesStore.setState({ projectDictionaryLocale: "de_DE" });
    useFilesStore.setState({ projectDictionaryLocale: "en_US" });
    useFilesStore.setState({ projectDictionaryLocale: null });

    window.removeEventListener("oleafly:proofreading-settings-changed", changed);
    expect(changed).toHaveBeenCalledTimes(2);
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      setting: "projectDictionaryLocale",
    });
  });

  it("stays quiet when another project opens", () => {
    const changed = vi.fn();
    window.addEventListener("oleafly:proofreading-settings-changed", changed);

    useFilesStore.setState({ projectId: "other", projectDictionaryLocale: "fr_FR" });

    window.removeEventListener("oleafly:proofreading-settings-changed", changed);
    expect(changed).not.toHaveBeenCalled();
  });
});

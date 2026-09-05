import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { installUiDom } = await import("./acp/tests/ui-fixtures");
  return installUiDom();
});
vi.mock("@/lib/browser-window", () => ({ openBrowserWindow: vi.fn() }));
vi.mock("@/lib/research-workspace", async (original) => ({ ...await original<typeof import("@/lib/research-workspace")>(), readResearchRootFile: vi.fn() }));
vi.mock("@/lib/tauri", async (original) => ({ ...await original<typeof import("@/lib/tauri")>(), readFileContent: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/editor/cm/controller", () => ({ waitForEditorDocument: vi.fn(), gotoLine: vi.fn() }));
import { gotoLine, waitForEditorDocument } from "@/components/editor/cm/controller";
import { openBrowserWindow } from "@/lib/browser-window";
import { readResearchRootFile } from "@/lib/research-workspace";
import { readFileContent } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { deferred } from "./acp/tests/ui-fixtures";
import { useResearchChatActions } from "./use-research-chat-actions";

const editor = {} as NonNullable<Awaited<ReturnType<typeof waitForEditorDocument>>>;

beforeEach(() => {
  vi.resetAllMocks();
  useFilesStore.setState({ projectId: "paper", files: {}, activePath: null, openTabs: [], tabOrder: {} });
  useSettingsStore.setState({ viewMode: "pdf" });
  vi.mocked(openBrowserWindow).mockResolvedValue(true);
  vi.mocked(readFileContent).mockResolvedValue("Methods\r\nResults\r\nConclusion");
  vi.mocked(waitForEditorDocument).mockResolvedValue(editor);
});
afterEach(cleanup);
afterAll(restore);

describe("research chat artifact actions", () => {
  it("opens a project result in the editor and navigates only once its document is ready", async () => {
    const ready = deferred<typeof editor | null>();
    vi.mocked(waitForEditorDocument).mockReturnValue(ready.promise);
    const { result } = renderHook(() => useResearchChatActions("paper"));
    const opening = result.current.openArtifact?.({ scope: "project", projectId: "paper", path: "chapters\\methods.tex", line: 3 });
    await waitFor(() => expect(waitForEditorDocument).toHaveBeenCalledWith("chapters/methods.tex", expect.any(AbortSignal)));
    expect(readFileContent).toHaveBeenCalledExactlyOnceWith("paper", "chapters/methods.tex");
    expect(useFilesStore.getState()).toMatchObject({ activePath: "chapters/methods.tex", openTabs: ["chapters/methods.tex"], files: { "chapters/methods.tex": { content: "Methods\nResults\nConclusion", dirty: false } } });
    expect(useSettingsStore.getState().viewMode).toBe("split");
    expect(gotoLine).not.toHaveBeenCalled();
    ready.resolve(editor);
    await opening;
    expect(gotoLine).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("keeps linked evidence as a read-only preview instead of opening it as a project file", async () => {
    const preview = { rootId: "root-42", bytesRead: 19, relativePath: "notes/source.md", content: "Supporting evidence", truncated: true, isBinary: false };
    vi.mocked(readResearchRootFile).mockResolvedValue(preview);
    const { result } = renderHook(() => useResearchChatActions("paper"));
    expect(await result.current.openArtifact?.({ scope: "linked", rootId: "root-42", relativePath: "notes/source.md" })).toEqual(preview);
    expect(readResearchRootFile).toHaveBeenCalledExactlyOnceWith("paper", "root-42", "notes/source.md");
    expect(readFileContent).not.toHaveBeenCalled();
    expect(useFilesStore.getState().activePath).toBeNull();
    expect(useSettingsStore.getState().viewMode).toBe("pdf");
  });

  it("rejects escaped, confidential, and foreign-project paths before any native read", async () => {
    const { result, rerender } = renderHook(({ projectId }: { projectId: string | null }) => useResearchChatActions(projectId), { initialProps: { projectId: "paper" as string | null } });
    for (const path of ["../other/main.tex", "/etc/hosts", "C:\\notes.tex", ".PrIvAtE/notes.tex", "chapters/.git/config", "bad\0name"]) {
      await result.current.openArtifact?.({ scope: "project", path });
    }
    expect(toast.error).toHaveBeenCalledTimes(6);
    await result.current.openArtifact?.({ scope: "project", projectId: "another-project", path: "main.tex" });
    useFilesStore.setState({ projectId: "another-project" });
    await result.current.openArtifact?.({ scope: "project", path: "main.tex" });
    rerender({ projectId: null });
    await result.current.openArtifact?.({ scope: "linked", rootId: "root-42", relativePath: "notes.md" });
    expect(readFileContent).not.toHaveBeenCalled();
    expect(readResearchRootFile).not.toHaveBeenCalled();
    expect(useFilesStore.getState().openTabs).toEqual([]);
  });

  it("does not open a result or move the cursor after the user switches projects", async () => {
    const read = deferred<string>();
    vi.mocked(readFileContent).mockReturnValueOnce(read.promise);
    const { result } = renderHook(() => useResearchChatActions("paper"));
    const loading = result.current.openArtifact?.({ scope: "project", path: "main.tex", line: 2 });
    expect(readFileContent).toHaveBeenCalledOnce();
    useFilesStore.setState({ projectId: "another-project", activePath: "other.tex" });
    read.resolve("Old project text");
    await loading;
    expect(useFilesStore.getState()).toMatchObject({ activePath: "other.tex", files: {}, openTabs: [] });
    expect(waitForEditorDocument).not.toHaveBeenCalled();
    useFilesStore.setState({ projectId: "paper", activePath: null });
    const ready = deferred<typeof editor | null>();
    vi.mocked(waitForEditorDocument).mockReturnValueOnce(ready.promise);
    const opening = result.current.openArtifact?.({ scope: "project", path: "main.tex", line: 2 });
    await waitFor(() => expect(waitForEditorDocument).toHaveBeenCalledOnce());
    useFilesStore.setState({ projectId: "another-project", activePath: "other.tex" });
    ready.resolve(editor);
    await opening;
    expect(gotoLine).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reports an unreadable result and allows retry without changing the preview mode prematurely", async () => {
    vi.mocked(readFileContent).mockRejectedValueOnce(new Error("File was removed"));
    const { result } = renderHook(() => useResearchChatActions("paper"));
    await result.current.openArtifact?.({ scope: "project", path: "main.tex" });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("The result file could not be opened.");
    expect(useSettingsStore.getState().viewMode).toBe("pdf");
    expect(useFilesStore.getState().activePath).toBeNull();
    await result.current.openArtifact?.({ scope: "project", path: "main.tex" });
    expect(useFilesStore.getState().activePath).toBe("main.tex");
    expect(useSettingsStore.getState().viewMode).toBe("split");
    expect(gotoLine).not.toHaveBeenCalled();
  });
});

describe("research chat source actions", () => {
  it("opens safe source links with DOI and OpenAlex fallbacks without forwarding unsafe URLs", async () => {
    const { result } = renderHook(() => useResearchChatActions("paper"));
    await act(async () => {
      result.current.openSource?.({ url: "https://journal.example/paper", doi: "10.1234/ignored" });
      result.current.openSource?.({ url: "javascript:alert(1)", doi: "https://dx.doi.org/10.1234/example" });
      result.current.openSource?.({ sourceId: "W12345" });
    });
    expect(vi.mocked(openBrowserWindow).mock.calls).toEqual([["https://journal.example/paper"], ["https://doi.org/10.1234/example"], ["https://openalex.org/W12345"]]);
    expect(toast.error).not.toHaveBeenCalled();
    result.current.openSource?.({ url: "file:///outside/project.txt", sourceId: "untrusted", doi: "invalid" });
    expect(openBrowserWindow).toHaveBeenCalledTimes(3);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("This result does not include a source link.");
  });

  it("reports both declined and failed native browser launches", async () => {
    vi.mocked(openBrowserWindow).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("Window unavailable"));
    const { result } = renderHook(() => useResearchChatActions("paper"));
    await act(async () => {
      result.current.openSource?.({ url: "https://journal.example/first" });
      result.current.openSource?.({ url: "https://journal.example/second" });
    });
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenLastCalledWith("The source could not be opened.");
  });
});

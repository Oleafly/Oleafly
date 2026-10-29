import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/typst-forms", () => ({ loadTypstFormCatalog: load }));

import { EMPTY_TYPST_FORM_CATALOG, type TypstFormCatalog } from "@oleafly/editor/typst-forms";
import { LATEX_ENGINE, UNKNOWN_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import {
  CHANGE_DEBOUNCE_MS,
  formsChangeNeedsRefresh,
  formsRefreshNeeded,
  RETRY_DELAY_MS,
  startTypstFormsSync,
  useTypstFormsStore,
  WANT_DEBOUNCE_MS,
} from "./typst-forms";

const TYPST_ENGINE: DocumentEngineDescriptor = { ...LATEX_ENGINE, id: "typst" };

function catalog(version: string, watch: string[] = ["oleafly-forms.toml"]): TypstFormCatalog {
  return { ...EMPTY_TYPST_FORM_CATALOG, version, watch };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(() => {
  startTypstFormsSync();
});

beforeEach(async () => {
  load.mockReset();
  load.mockResolvedValue(catalog("v1"));
  useFilesStore.setState({ projectId: null, files: {}, tree: [], engine: UNKNOWN_ENGINE, engineLoaded: false, mainDoc: "main.typ" });
  useTypstFormsStore.setState({ projectId: null, catalog: EMPTY_TYPST_FORM_CATALOG, wanted: [] });
  load.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

async function openProject(projectId = "p1"): Promise<void> {
  useFilesStore.setState({ projectId });
  await vi.waitFor(() => expect(useTypstFormsStore.getState().catalog.version).not.toBe(""));
}

describe("the Typst forms store", () => {
  it("loads the project's catalog when a project opens and resets on a switch", async () => {
    await openProject("p1");
    expect(load).toHaveBeenCalledWith("p1", []);
    useTypstFormsStore.setState({ wanted: ["@local/a:1.0.0"] });
    load.mockResolvedValue(catalog("v2"));
    useFilesStore.setState({ projectId: "p2" });
    expect(useTypstFormsStore.getState()).toMatchObject({ projectId: "p2", wanted: [], catalog: EMPTY_TYPST_FORM_CATALOG });
    await vi.waitFor(() => expect(useTypstFormsStore.getState().catalog.version).toBe("v2"));
    expect(load).toHaveBeenLastCalledWith("p2", []);
  });

  it("unions, dedupes and debounces wanted packages", async () => {
    await openProject();
    vi.useFakeTimers();
    load.mockClear();
    useTypstFormsStore.getState().want(["@local/b:1.0.0", "@local/a:1.0.0"]);
    useTypstFormsStore.getState().want(["@local/a:1.0.0"]);
    useTypstFormsStore.getState().want(["@local/c:1.0.0", "@local/c:1.0.0"]);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WANT_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledExactlyOnceWith("p1", ["@local/a:1.0.0", "@local/b:1.0.0", "@local/c:1.0.0"]);
    useTypstFormsStore.getState().want(["@local/a:1.0.0"]);
    await vi.advanceTimersByTimeAsync(WANT_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("ignores an answer to an older request", async () => {
    await openProject();
    const slow = deferred<TypstFormCatalog>();
    load.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(catalog("fast"));
    const first = useTypstFormsStore.getState().refresh();
    await useTypstFormsStore.getState().refresh();
    slow.resolve(catalog("slow"));
    await first;
    expect(useTypstFormsStore.getState().catalog.version).toBe("fast");
  });

  it("keeps the same catalog object while the version is unchanged", async () => {
    await openProject();
    const before = useTypstFormsStore.getState().catalog;
    load.mockResolvedValue(catalog("v1"));
    await useTypstFormsStore.getState().refresh();
    expect(useTypstFormsStore.getState().catalog).toBe(before);
  });

  it("keeps the catalog when the backend fails", async () => {
    await openProject();
    const before = useTypstFormsStore.getState().catalog;
    load.mockRejectedValue(new Error("gone"));
    await useTypstFormsStore.getState().refresh();
    expect(useTypstFormsStore.getState().catalog).toBe(before);
  });

  it("reloads after an in-app save of a watched file, and not of other files", async () => {
    await openProject();
    load.mockClear();
    useFilesStore.setState({ files: { "oleafly-forms.toml": { content: "x", dirty: true }, "main.typ": { content: "y", dirty: true } } });
    useFilesStore.setState({ files: { "oleafly-forms.toml": { content: "x", dirty: true }, "main.typ": { content: "y", dirty: false } } });
    expect(load).not.toHaveBeenCalled();
    useFilesStore.setState({ files: { "oleafly-forms.toml": { content: "x", dirty: false }, "main.typ": { content: "y", dirty: false } } });
    expect(load).toHaveBeenCalledOnce();
  });

  it("reloads after a compile only when the documents import packages", async () => {
    await openProject();
    load.mockClear();
    useCompileStore.setState({ lastCompiledAt: 1 });
    expect(load).not.toHaveBeenCalled();
    useTypstFormsStore.setState({ wanted: ["@local/a:1.0.0"] });
    useCompileStore.setState({ lastCompiledAt: 2 });
    expect(load).toHaveBeenCalledOnce();
  });

  it("does nothing without a project", async () => {
    await useTypstFormsStore.getState().refresh();
    expect(load).not.toHaveBeenCalled();
  });

  it("reads one catalog at a time, once more for calls made meanwhile, and applies each answer", async () => {
    await openProject();
    const first = deferred<TypstFormCatalog>();
    const second = deferred<TypstFormCatalog>();
    load.mockClear();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(catalog("v4"));
    const running = useTypstFormsStore.getState().refresh();
    void useTypstFormsStore.getState().refresh();
    void useTypstFormsStore.getState().refresh();
    expect(load).toHaveBeenCalledOnce();

    first.resolve(catalog("v2"));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(useTypstFormsStore.getState().catalog.version).toBe("v2");
    void useTypstFormsStore.getState().refresh();
    second.resolve(catalog("v3"));
    await running;
    expect(load).toHaveBeenCalledTimes(3);
    expect(useTypstFormsStore.getState()).toMatchObject({ catalog: { version: "v4" }, loadedWith: [] });
  });

  it("starts the next project's read without waiting for the last project's", async () => {
    await openProject("p1");
    const stuck = deferred<TypstFormCatalog>();
    load.mockReturnValueOnce(stuck.promise).mockResolvedValue(catalog("p2"));
    void useTypstFormsStore.getState().refresh();
    useFilesStore.setState({ projectId: "p2" });
    await vi.waitFor(() => expect(useTypstFormsStore.getState().catalog.version).toBe("p2"));
    expect(load).toHaveBeenLastCalledWith("p2", []);
    stuck.resolve(catalog("stale"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useTypstFormsStore.getState().catalog.version).toBe("p2");
  });

  it("skips the backend outside Typst projects and reloads when the engine or main document changes", async () => {
    useFilesStore.setState({ projectId: "p1", engine: LATEX_ENGINE, engineLoaded: true, mainDoc: "main.tex" });
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    expect(useTypstFormsStore.getState().catalog).toBe(EMPTY_TYPST_FORM_CATALOG);

    useFilesStore.setState({ engine: TYPST_ENGINE, mainDoc: "main.typ" });
    await vi.waitFor(() => expect(useTypstFormsStore.getState().catalog.version).toBe("v1"));
    expect(load).toHaveBeenCalledExactlyOnceWith("p1", []);

    // Set as main hides the engine while it switches; only the settled engine counts.
    useFilesStore.setState({ engine: UNKNOWN_ENGINE, engineLoaded: false });
    useFilesStore.setState({ mainDoc: "report.typ" });
    expect(load).toHaveBeenCalledOnce();
    useFilesStore.setState({ engine: TYPST_ENGINE, engineLoaded: true });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    useFilesStore.setState({ files: { "main.typ": { content: "x", dirty: false } } });

    useFilesStore.setState({ engine: LATEX_ENGINE });
    await vi.waitFor(() => expect(useTypstFormsStore.getState().catalog).toBe(EMPTY_TYPST_FORM_CATALOG));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads once a burst of changes to a watched file's clean buffer settles", async () => {
    await openProject();
    vi.useFakeTimers();
    load.mockClear();
    const forms = (content: string, extra = {}) =>
      useFilesStore.setState({ files: { "oleafly-forms.toml": { content, dirty: false }, ...extra } });
    forms("a");
    forms("b");
    forms("b", { "main.typ": { content: "y", dirty: false } });
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS - 1);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledOnce();

    forms("b", { "main.typ": { content: "z", dirty: false } });
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("reloads when a watched file is closed, deleted, or appears in or leaves the file tree", async () => {
    await openProject();
    useFilesStore.setState({ files: { "oleafly-forms.toml": { content: "a", dirty: true } } });
    vi.useFakeTimers();
    load.mockClear();
    useFilesStore.setState({ files: {} });
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledOnce();

    useFilesStore.setState({ tree: [{ path: "main.typ", is_dir: false }, { path: "oleafly-forms.toml", is_dir: false }] });
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledTimes(2);
    useFilesStore.setState({ tree: [{ path: "main.typ", is_dir: false }] });
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledTimes(3);
    useFilesStore.setState({ tree: [{ path: "main.typ", is_dir: false }, { path: "notes.typ", is_dir: false }] });
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("tries a failed first load once more, and reloads on any save until one works", async () => {
    vi.useFakeTimers();
    load.mockRejectedValue(new Error("locked"));
    useFilesStore.setState({ projectId: "p1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();
    expect(formsChangeNeedsRefresh(["main.typ"])).toBe(true);

    useFilesStore.setState({ files: { "main.typ": { content: "x", dirty: true } } });
    useFilesStore.setState({ files: { "main.typ": { content: "x", dirty: false } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);

    load.mockResolvedValue(catalog("v1"));
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(load).toHaveBeenCalledTimes(3);
    expect(useTypstFormsStore.getState().catalog.version).toBe("v1");
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2);
    expect(load).toHaveBeenCalledTimes(3);

    expect(formsChangeNeedsRefresh(["main.typ"])).toBe(false);
    useFilesStore.setState({ files: { "main.typ": { content: "y", dirty: true } } });
    useFilesStore.setState({ files: { "main.typ": { content: "y", dirty: false } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe("formsRefreshNeeded", () => {
  const forms = catalog("v", ["oleafly-forms.toml", "typst/packages/local/acme/0.1.0/typst.toml"]);

  it.each([
    [["oleafly-forms.toml"], true],
    [["typst/packages"], true],
    [["main.typ"], false],
    [["oleafly-forms.toml.bak"], false],
    [[], false],
  ])("for %j is %s", (paths, expected) => {
    expect(formsRefreshNeeded(paths, forms)).toBe(expected);
  });
});

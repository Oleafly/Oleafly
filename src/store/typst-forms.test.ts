import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/typst-forms", () => ({ loadTypstFormCatalog: load }));

import { EMPTY_TYPST_FORM_CATALOG, type TypstFormCatalog } from "@oleafly/editor/typst-forms";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { formsRefreshNeeded, startTypstFormsSync, useTypstFormsStore, WANT_DEBOUNCE_MS } from "./typst-forms";

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
  useFilesStore.setState({ projectId: null, files: {} });
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

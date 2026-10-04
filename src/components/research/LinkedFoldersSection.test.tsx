import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchRootFileEntry, ResearchWorkspace } from "@/lib/research-workspace";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

let LinkedFoldersSection: typeof import("./LinkedFoldersSection").LinkedFoldersSection;
let joinPath: typeof import("./LinkedFoldersSection").joinPath;
let useLinkedRootsStore: typeof import("./linked-roots-store").useLinkedRootsStore;
let useFilesStore: typeof import("@/store/files").useFilesStore;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let within: typeof import("@testing-library/react").within;

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

vi.mock("@/store/files", () => {
  let state: { projectId: string | null } = { projectId: null };
  const listeners = new Set<() => void>();
  const store = (selector: (value: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  store.setState = (next: Partial<typeof state>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  return { useFilesStore: store };
});

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://oleafly.test" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("HTMLInputElement", dom.window.HTMLInputElement);
  vi.stubGlobal("HTMLFormElement", dom.window.HTMLFormElement);
  vi.stubGlobal("HTMLSelectElement", dom.window.HTMLSelectElement);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("DocumentFragment", dom.window.DocumentFragment);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("NodeFilter", dom.window.NodeFilter);
  vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
  vi.stubGlobal("MutationObserver", dom.window.MutationObserver);
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => false },
    scrollIntoView: { configurable: true, value: vi.fn() },
  });
  ({ cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ useFilesStore } = await import("@/store/files"));
  ({ useLinkedRootsStore } = await import("./linked-roots-store"));
  ({ LinkedFoldersSection, joinPath } = await import("./LinkedFoldersSection"));
});

beforeEach(() => {
  native.invoke.mockReset();
  useFilesStore.setState({ projectId: "paper" });
  useLinkedRootsStore.setState({
    projectId: null, roots: [], health: {}, listings: {},
    loading: {}, errors: {}, expanded: [], error: null,
  });
});

afterEach(() => cleanup());

function workspace(): ResearchWorkspace {
  return {
    version: 1,
    primaryProjectId: "paper",
    updatedAtMs: 1,
    roots: [{
      id: "data-root", canonicalPath: "/study/data", identity: "identity",
      label: enResearchTools.roots.dialog.labelPlaceholder, role: "data", access: "read_only", createdAtMs: 1,
    }],
  };
}

function entry(relativePath: string, values: Partial<ResearchRootFileEntry> = {}): ResearchRootFileEntry {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  return { relativePath, name, isDirectory: false, isSymlink: false, size: 12, ...values };
}

function page() {
  return within(document.body);
}

describe("LinkedFoldersSection", () => {
  it("stays out of the tree when a project has no linked folders", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_research_workspace") return { ...workspace(), roots: [] };
      if (command === "research_root_health") return [];
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<LinkedFoldersSection />);
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("get_research_workspace", { projectId: "paper" }));
    expect(page().queryByTestId("linked-folders-section")).not.toBeInTheDocument();
  });

  it("lists one linked root lazily, one folder level at a time", async () => {
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_research_workspace") return workspace();
      if (command === "research_root_health") return [{ rootId: "data-root", availability: "available", detail: null }];
      if (command === "list_research_root_files") {
        return args.relativePath === ""
          ? { rootId: "data-root", path: "", truncated: false, entries: [entry("cohort", { isDirectory: true }), entry("readme.md")] }
          : { rootId: "data-root", path: args.relativePath, truncated: false, entries: [entry("cohort/values.csv")] };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<LinkedFoldersSection />);
    await waitFor(() => expect(page().getByTestId("linked-folders-section")).toBeInTheDocument());
    expect(native.invoke).not.toHaveBeenCalledWith("list_research_root_files", expect.anything());

    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.dialog.labelPlaceholder }));
    await waitFor(() => expect(page().getByRole("button", { name: "readme.md" })).toBeInTheDocument());
    expect(native.invoke).toHaveBeenCalledWith("list_research_root_files", {
      projectId: "paper", rootId: "data-root", relativePath: "", maxDepth: 0,
    });
    expect(page().queryByRole("button", { name: "values.csv" })).not.toBeInTheDocument();

    fireEvent.click(page().getByRole("button", { name: "cohort" }));
    await waitFor(() => expect(page().getByRole("button", { name: "values.csv" })).toBeInTheDocument());
    expect(native.invoke).toHaveBeenCalledWith("list_research_root_files", {
      projectId: "paper", rootId: "data-root", relativePath: "cohort", maxDepth: 0,
    });
  });

  it("opens a linked file in a read-only preview and never through the project editor", async () => {
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_research_workspace") return workspace();
      if (command === "research_root_health") return [{ rootId: "data-root", availability: "available", detail: null }];
      if (command === "list_research_root_files") return { rootId: "data-root", path: "", truncated: false, entries: [entry("readme.md")] };
      if (command === "read_research_root_file") {
        return { rootId: "data-root", relativePath: args.relativePath, content: "linked source text", bytesRead: 18, truncated: false, isBinary: false };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<LinkedFoldersSection />);
    await waitFor(() => expect(page().getByTestId("linked-folders-section")).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.dialog.labelPlaceholder }));
    await waitFor(() => expect(page().getByRole("button", { name: "readme.md" })).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name: "readme.md" }));
    await waitFor(() => expect(page().getByText("linked source text")).toBeInTheDocument());
    expect(page().getByRole("dialog")).toHaveTextContent("Read only preview");
    expect(page().getByRole("button", { name: enResearchTools.linked.copyPath })).toBeInTheDocument();
    expect(native.invoke.mock.calls.map(([command]) => command)).not.toContain("read_file_content");
  });

  it("marks a symlink as blocked instead of opening it", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_research_workspace") return workspace();
      if (command === "research_root_health") return [{ rootId: "data-root", availability: "available", detail: null }];
      if (command === "list_research_root_files") {
        return { rootId: "data-root", path: "", truncated: false, entries: [entry("outside.csv", { isSymlink: true })] };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<LinkedFoldersSection />);
    await waitFor(() => expect(page().getByTestId("linked-folders-section")).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.dialog.labelPlaceholder }));
    await waitFor(() => expect(page().getByText("Blocked link")).toBeInTheDocument());
    expect(page().queryByRole("button", { name: "outside.csv" })).not.toBeInTheDocument();
  });

  it("reports a missing root and surfaces a failed listing without losing the section", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_research_workspace") return workspace();
      if (command === "research_root_health") {
        return [{ rootId: "data-root", availability: "missing", detail: "This folder is missing or its drive is not mounted." }];
      }
      if (command === "list_research_root_files") throw new Error("could not list linked folder");
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<LinkedFoldersSection />);
    await waitFor(() => expect(page().getByText("Missing")).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name: /Study data/ }));
    await waitFor(() => expect(page().getByRole("alert")).toHaveTextContent("could not list linked folder"));
    expect(page().getByTestId("linked-folders-section")).toBeInTheDocument();
  });
});

describe("LinkedFoldersSection previews and states", () => {
  const linked = enResearchTools.linked;
  const rootName = enResearchTools.roots.dialog.labelPlaceholder;

  function backend(
    files: ResearchRootFileEntry[],
    read: (relativePath: string) => unknown,
    availability = "available",
  ) {
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_research_workspace") return workspace();
      if (command === "research_root_health") return [{ rootId: "data-root", availability, detail: null }];
      if (command === "list_research_root_files") return { rootId: "data-root", path: "", truncated: false, entries: files };
      if (command === "read_research_root_file") return read(args.relativePath);
      throw new Error(`Unexpected command: ${command}`);
    });
  }

  async function openRoot() {
    render(<LinkedFoldersSection />);
    await waitFor(() => expect(page().getByTestId("linked-folders-section")).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name: new RegExp(rootName) }));
  }

  async function openFile(name: string) {
    await waitFor(() => expect(page().getByRole("button", { name })).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name }));
  }

  it("explains a binary file and copies its full path", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    backend([entry("scan.pdf")], (relativePath) => ({
      rootId: "data-root", relativePath, content: "", bytesRead: 4, truncated: false, isBinary: true,
    }));
    await openRoot();
    await openFile("scan.pdf");

    await waitFor(() => expect(page().getByText(linked.binary)).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name: linked.copyPath }));

    await waitFor(() => expect(page().getByRole("button", { name: linked.pathCopied })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith("/study/data/scan.pdf");
    fireEvent.click(page().getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);
    await waitFor(() => expect(page().queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says when a long preview was cut short", async () => {
    backend([entry("big.log")], (relativePath) => ({
      rootId: "data-root", relativePath, content: "first lines", bytesRead: 262144, truncated: true, isBinary: false,
    }));
    await openRoot();
    await openFile("big.log");

    await waitFor(() => expect(page().getByText("first lines")).toBeInTheDocument());
    expect(page().getByText(linked.previewTruncated)).toBeInTheDocument();
  });

  it("shows why a file could not be read", async () => {
    backend([entry("locked.csv"), entry("other.csv")], (relativePath) => {
      if (relativePath === "locked.csv") throw new Error("permission denied");
      throw "busy";
    });
    await openRoot();
    await openFile("locked.csv");

    await waitFor(() => expect(page().getByRole("alert")).toHaveTextContent("permission denied"));
  });

  it("names a root that cannot be read and an empty folder", async () => {
    backend([], () => null, "unreadable");
    await openRoot();

    expect(page().getByText(linked.unreadable)).toBeInTheDocument();
    await waitFor(() => expect(page().getByText(linked.emptyFolder)).toBeInTheDocument());
  });

  it("reloads the linked folders on request", async () => {
    backend([], () => null);
    render(<LinkedFoldersSection />);
    await waitFor(() => expect(page().getByTestId("linked-folders-section")).toBeInTheDocument());
    const reads = () => native.invoke.mock.calls.filter(([command]) => command === "get_research_workspace").length;
    const before = reads();

    fireEvent.click(page().getByRole("button", { name: linked.refresh }));

    await waitFor(() => expect(reads()).toBe(before + 1));
  });
});

describe("joinPath", () => {
  it("drops a trailing separator run before joining", () => {
    expect(joinPath("/Users/me/data", "notes/day1.csv")).toBe("/Users/me/data/notes/day1.csv");
    expect(joinPath("/Users/me/data/", "notes/day1.csv")).toBe("/Users/me/data/notes/day1.csv");
    expect(joinPath("/Users/me/data///", "notes/day1.csv")).toBe("/Users/me/data/notes/day1.csv");
  });

  it("keeps Windows roots on backslashes", () => {
    expect(joinPath("C:\\data", "notes/day1.csv")).toBe("C:\\data\\notes\\day1.csv");
    expect(joinPath("C:\\data\\", "notes/day1.csv")).toBe("C:\\data\\notes\\day1.csv");
  });

  it("matches the trailing-separator regex it replaced", () => {
    for (const root of ["/a", "/a/", "/a//", "\\\\server\\share\\", "", "/", "//"]) {
      const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
      expect(joinPath(root, "f/g")).toBe(
        `${root.replace(/[\\/]+$/, "")}${separator}${"f/g".replaceAll("/", separator)}`,
      );
    }
  });
});

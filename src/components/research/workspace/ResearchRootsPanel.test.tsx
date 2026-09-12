import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LinkedResearchRoot,
  ResearchRootFileContent,
  ResearchRootFileEntry,
  ResearchRootHealth,
  ResearchWorkspace,
} from "@/lib/research-workspace";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

let ResearchRootsPanel: typeof import("./ResearchRootsPanel").ResearchRootsPanel;
let act: typeof import("@testing-library/react").act;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let within: typeof import("@testing-library/react").within;
let userEvent: typeof import("@testing-library/user-event").default;

const native = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), reveal: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open }));
vi.mock("@/lib/tauri", () => ({ revealInDir: native.reveal }));

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
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => dom.window.clearTimeout(handle));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => {} },
    scrollIntoView: { configurable: true, value: vi.fn() },
  });
  ({ act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ default: userEvent } = await import("@testing-library/user-event"));
  ({ ResearchRootsPanel } = await import("./ResearchRootsPanel"));
});

beforeEach(() => {
  native.invoke.mockReset();
  native.open.mockReset();
  native.reveal.mockReset();
});
afterEach(() => cleanup());

function root(): LinkedResearchRoot {
  return { id: "data-root", canonicalPath: "/study/data", identity: "folder-identity", label: enResearchTools.roots.dialog.labelPlaceholder, role: "data", access: "read_only", createdAtMs: 1 };
}

function workspace(roots: LinkedResearchRoot[] = []): ResearchWorkspace {
  return { version: 1, primaryProjectId: "paper", roots, updatedAtMs: 1 };
}

function healthy(roots: LinkedResearchRoot[]): ResearchRootHealth[] {
  return roots.map((entry) => ({ rootId: entry.id, availability: "available" as const, detail: null }));
}

function file(relativePath: string, values: Partial<ResearchRootFileEntry> = {}): ResearchRootFileEntry {
  return { relativePath, name: relativePath, isDirectory: false, isSymlink: false, size: 24, ...values };
}

function content(relativePath: string, values: Partial<ResearchRootFileContent> = {}): ResearchRootFileContent {
  return { rootId: "data-root", relativePath, content: "participant,value\n1,23", bytesRead: 22, truncated: false, isBinary: false, ...values };
}

function page() {
  return within(document.body);
}

async function fillLabel(value: string) {
  const user = userEvent.setup({ document });
  const input = page().getByLabelText(enResearchTools.roots.dialog.labelLabel);
  await user.clear(input);
  await user.type(input, value);
}

function select(label: string, option: string) {
  fireEvent.keyDown(page().getByLabelText(label), { key: "ArrowDown" });
  fireEvent.click(page().getByRole("option", { name: option }));
}

function openMenu(label: string) {
  const name = enResearchTools.roots.card.moreActions.replace("{{label}}", label);
  fireEvent.keyDown(page().getByRole("button", { name }), { key: "Enter" });
}

describe("ResearchRootsPanel", () => {
  it("links a picked folder read-only through a dialog, edits it, and unlinks after confirmation", async () => {
    let saved = workspace();
    native.open.mockResolvedValue("/study/data");
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_research_workspace") return saved;
      if (command === "research_root_health") return healthy(saved.roots);
      if (command === "add_research_root") {
        saved = workspace([{ ...root(), ...args.request, canonicalPath: args.request.path }]);
        return saved;
      }
      if (command === "update_research_root") {
        saved = workspace([{ ...saved.roots[0], ...args.request }]);
        return saved;
      }
      if (command === "remove_research_root") {
        saved = workspace();
        return saved;
      }
      throw new Error(`Unexpected native mutation: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByText(enResearchTools.roots.empty)).toBeInTheDocument());

    fireEvent.click(page().getAllByRole("button", { name: "Link folder" })[0]);
    const dialog = () => within(page().getByRole("dialog"));
    expect(dialog().getByRole("button", { name: "Link folder" })).toBeDisabled();
    expect(page().getByLabelText(enResearchTools.roots.dialog.folderLabel)).toHaveAttribute("readonly");
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.dialog.chooseFolder }));
    await waitFor(() => expect(page().getByLabelText(enResearchTools.roots.dialog.labelLabel)).toHaveValue("data"));
    expect(native.open).toHaveBeenCalledExactlyOnceWith({ directory: true, multiple: false, title: enResearchTools.roots.dialog.pickerTitle });
    await fillLabel("Study data");
    fireEvent.click(dialog().getByRole("button", { name: "Link folder" }));
    await waitFor(() => expect(page().getByRole("article")).toBeInTheDocument());
    expect(native.invoke).toHaveBeenCalledWith("add_research_root", {
      request: { projectId: "paper", path: "/study/data", label: enResearchTools.roots.dialog.labelPlaceholder, role: "data", access: "read_only" },
    });
    const card = () => within(page().getByRole("article"));
    expect(card().getByText("Read only")).toBeInTheDocument();
    expect(card().getByText("Available")).toBeInTheDocument();
    expect(card().getByText(enResearchTools.roots.role.data)).toBeInTheDocument();

    openMenu("Study data");
    fireEvent.click(page().getByRole("menuitem", { name: enCommon.actions.edit }));
    await waitFor(() => expect(page().getByRole("dialog")).toBeInTheDocument());
    await fillLabel("Analysis scripts");
    select(enResearchTools.roots.dialog.roleAria, "Analysis");
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.dialog.save }));
    await waitFor(() => expect(page().queryByRole("dialog")).not.toBeInTheDocument());
    expect(native.invoke).toHaveBeenCalledWith("update_research_root", {
      request: { projectId: "paper", rootId: "data-root", label: "Analysis scripts", role: "analysis", access: "read_only" },
    });

    openMenu("Analysis scripts");
    fireEvent.click(page().getByRole("menuitem", { name: "Unlink" }));
    fireEvent.click(within(page().getByRole("alertdialog")).getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(page().queryByRole("article")).not.toBeInTheDocument());
    expect(native.invoke).toHaveBeenCalledWith("remove_research_root", { projectId: "paper", rootId: "data-root" });
    expect(native.invoke).not.toHaveBeenCalledWith("write_research_root_file", expect.anything());
  });

  it("keeps a linked folder when the unlink confirmation is dismissed", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_research_workspace") return workspace([root()]);
      if (command === "research_root_health") return healthy([root()]);
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByRole("article")).toBeInTheDocument());
    openMenu("Study data");
    fireEvent.click(page().getByRole("menuitem", { name: "Unlink" }));
    fireEvent.click(within(page().getByRole("alertdialog")).getByRole("button", { name: /Cancel/ }));
    expect(page().getByRole("article")).toBeInTheDocument();
    expect(native.invoke).not.toHaveBeenCalledWith("remove_research_root", expect.anything());
  });

  it("reports a missing folder instead of showing it as healthy", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_research_workspace") return workspace([root()]);
      if (command === "research_root_health") {
        return [{ rootId: "data-root", availability: "missing", detail: "This folder is missing or its drive is not mounted." }];
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByText("Missing")).toBeInTheDocument());
    expect(page().queryByText("Available")).not.toBeInTheDocument();
    openMenu("Study data");
    expect(page().getByRole("menuitem", { name: "Unlink" })).toBeInTheDocument();
  });

  it("still lists linked folders when the health check fails", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_research_workspace") return workspace([root()]);
      if (command === "research_root_health") throw new Error("Health check unavailable");
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByRole("article")).toBeInTheDocument());
    expect(page().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reveals the linked folder in the desktop file manager", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_research_workspace") return workspace([root()]);
      if (command === "research_root_health") return healthy([root()]);
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByRole("article")).toBeInTheDocument());
    openMenu("Study data");
    fireEvent.click(page().getByRole("menuitem", { name: /Show in (Finder|Explorer)/ }));
    expect(native.reveal).toHaveBeenCalledWith("/study/data");
  });

  it("inspects bounded read-only content, blocks directories and symlinks, and labels binary/truncated previews", async () => {
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_research_workspace") return workspace([root()]);
      if (command === "research_root_health") return healthy([root()]);
      if (command === "list_research_root_files") return {
        rootId: "data-root", path: "", truncated: true,
        entries: [file("participants.csv"), file("archive", { isDirectory: true }), file("outside.csv", { isSymlink: true }), file("scan.bin")],
      };
      if (command === "read_research_root_file") return content(args.relativePath, args.relativePath === "scan.bin" ? { isBinary: true, content: "must not render" } : { truncated: true });
      throw new Error(`Unexpected native mutation: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByRole("button", { name: enResearchTools.roots.card.browse })).toBeEnabled());
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.card.browse }));
    await waitFor(() => expect(page().getByRole("button", { name: "participants.csv" })).toBeInTheDocument());
    expect(page().getByRole("alert")).toHaveTextContent("2,000 files or eight folder levels");
    expect(page().getByRole("button", { name: "archive" })).toBeDisabled();
    expect(page().getByRole("button", { name: /outside\.csv/ })).toBeDisabled();
    expect(page().getByRole("button", { name: /outside\.csv/ })).toHaveTextContent("Blocked link");
    fireEvent.click(page().getByRole("button", { name: /outside\.csv/ }));
    fireEvent.click(page().getByRole("button", { name: "participants.csv" }));
    await waitFor(() => expect(page().getByText("Preview stopped at 256 KiB.")).toBeInTheDocument());
    expect(page().getByText(/participant,value/).tagName).toBe("PRE");
    expect(native.invoke).toHaveBeenCalledWith("list_research_root_files", { projectId: "paper", rootId: "data-root", relativePath: "", maxDepth: 8 });
    expect(native.invoke).toHaveBeenCalledWith("read_research_root_file", { projectId: "paper", rootId: "data-root", relativePath: "participants.csv", maxBytes: 256 * 1024 });
    fireEvent.click(page().getByRole("button", { name: "scan.bin" }));
    await waitFor(() => expect(page().getByText(enResearchTools.roots.card.binary)).toBeInTheDocument());
    expect(page().queryByText("must not render")).not.toBeInTheDocument();
    expect(native.invoke.mock.calls.filter(([command]) => command === "read_research_root_file").map(([, args]) => args.relativePath)).toEqual(["participants.csv", "scan.bin"]);
  });

  it("keeps a rejected link draft for retry and treats a cancelled folder picker as no change", async () => {
    let failed = true;
    native.open.mockResolvedValueOnce(null).mockResolvedValueOnce("/study/data");
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_research_workspace") return failed ? workspace() : workspace([root()]);
      if (command === "research_root_health") return healthy(failed ? [] : [root()]);
      if (command === "add_research_root") {
        if (failed) throw new Error("This folder is already linked");
        return workspace([root()]);
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getAllByRole("button", { name: "Link folder" })[0]).toBeEnabled());
    fireEvent.click(page().getAllByRole("button", { name: "Link folder" })[0]);
    const dialog = () => within(page().getByRole("dialog"));
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.dialog.chooseFolder }));
    await waitFor(() => expect(native.open).toHaveBeenCalledOnce());
    expect(page().getByLabelText(enResearchTools.roots.dialog.folderLabel)).toHaveValue("");
    expect(dialog().getByRole("button", { name: "Link folder" })).toBeDisabled();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.dialog.chooseFolder }));
    await waitFor(() => expect(page().getByLabelText(enResearchTools.roots.dialog.folderLabel)).toHaveValue("/study/data"));
    await fillLabel("Study data");
    select(enResearchTools.roots.dialog.roleAria, enResearchTools.roots.role.references);
    fireEvent.click(dialog().getByRole("button", { name: "Link folder" }));
    await waitFor(() => expect(page().getByRole("alert")).toHaveTextContent("already linked"));
    expect(page().getByLabelText(enResearchTools.roots.dialog.folderLabel)).toHaveValue("/study/data");
    expect(page().getByLabelText(enResearchTools.roots.dialog.labelLabel)).toHaveValue(enResearchTools.roots.dialog.labelPlaceholder);
    expect(page().getByLabelText(enResearchTools.roots.dialog.roleAria)).toHaveTextContent(enResearchTools.roots.role.references);
    failed = false;
    fireEvent.click(dialog().getByRole("button", { name: "Link folder" }));
    await waitFor(() => expect(page().getByRole("article")).toBeInTheDocument());
    expect(page().queryByRole("dialog")).not.toBeInTheDocument();
    expect(native.invoke.mock.calls.filter(([command]) => command === "add_research_root")).toHaveLength(2);
  });

  it("surfaces a failed workspace load and reads persisted links on a later mount", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "research_root_health") return healthy([root()]);
      throw new Error("Workspace is unavailable");
    });
    const first = render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByRole("alert")).toHaveTextContent("Workspace is unavailable"));
    first.unmount();
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_research_workspace") return workspace([root()]);
      if (command === "research_root_health") return healthy([root()]);
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByRole("article")).toBeInTheDocument());
    expect(page().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the latest selected file when native previews finish out of order", async () => {
    const reads = new Map<string, (value: ResearchRootFileContent) => void>();
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_research_workspace") return workspace([root()]);
      if (command === "research_root_health") return healthy([root()]);
      if (command === "list_research_root_files") return { entries: [file("first.csv"), file("second.csv")], truncated: false };
      if (command === "read_research_root_file") return new Promise<ResearchRootFileContent>((resolve) => { reads.set(args.relativePath, resolve); });
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByRole("button", { name: enResearchTools.roots.card.browse })).toBeEnabled());
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.card.browse }));
    await waitFor(() => expect(page().getByRole("button", { name: "first.csv" })).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name: "first.csv" }));
    fireEvent.click(page().getByRole("button", { name: "second.csv" }));
    expect([...reads.keys()]).toEqual(["first.csv", "second.csv"]);
    await act(async () => reads.get("second.csv")?.(content("second.csv", { content: "latest selected data" })));
    expect(page().getByText("latest selected data")).toBeInTheDocument();
    await act(async () => reads.get("first.csv")?.(content("first.csv", { content: "obsolete first data" })));
    expect(page().getByText("latest selected data")).toBeInTheDocument();
    expect(page().queryByText("obsolete first data")).not.toBeInTheDocument();
  });

  it("ignores an earlier preview error without unlocking controls for a newer pending preview", async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (value: ResearchRootFileContent) => void;
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_research_workspace") return workspace([root()]);
      if (command === "research_root_health") return healthy([root()]);
      if (command === "list_research_root_files") return { entries: [file("first.csv"), file("second.csv")], truncated: false };
      if (command === "read_research_root_file") return args.relativePath === "first.csv"
        ? new Promise<ResearchRootFileContent>((_resolve, reject) => { rejectFirst = reject; })
        : new Promise<ResearchRootFileContent>((resolve) => { resolveSecond = resolve; });
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<ResearchRootsPanel projectId="paper" />);
    await waitFor(() => expect(page().getByRole("button", { name: enResearchTools.roots.card.browse })).toBeEnabled());
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.card.browse }));
    await waitFor(() => expect(page().getByRole("button", { name: "first.csv" })).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name: "first.csv" }));
    fireEvent.click(page().getByRole("button", { name: "second.csv" }));
    await act(async () => rejectFirst(new Error("Obsolete read failed")));
    expect(page().queryByRole("alert")).not.toBeInTheDocument();
    expect(page().getByRole("button", { name: enResearchTools.roots.card.browse })).toBeDisabled();
    await act(async () => resolveSecond(content("second.csv", { content: "current data" })));
    expect(page().getByText("current data")).toBeInTheDocument();
    expect(page().getByRole("button", { name: enResearchTools.roots.card.browse })).toBeEnabled();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.roots.card.browse }));
    expect(page().queryByText("current data")).not.toBeInTheDocument();
    await waitFor(() => expect(page().getByRole("button", { name: enResearchTools.roots.card.browse })).toBeEnabled());
  });
});

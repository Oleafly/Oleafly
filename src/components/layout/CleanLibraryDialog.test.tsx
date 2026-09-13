// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
interface TestStore {
  projectId: string;
  files: Record<string, { content: string; dirty: boolean }>;
  tree: { path: string; is_dir: boolean }[];
  engine: { capabilities: { formatting_profile: string } };
  runExternalProjectMutation: ReturnType<typeof vi.fn>;
  flushForQuit: ReturnType<typeof vi.fn>;
}
const mocks = vi.hoisted(() => ({ clean: vi.fn(), notify: vi.fn(), success: vi.fn(), mutation: vi.fn(), flush: vi.fn(), state: {} as TestStore }));
vi.mock("@/lib/tauri", () => ({ cleanBibtexLibrary: mocks.clean }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notify, toast: { success: mocks.success } }));
vi.mock("@/features/citation", () => ({ selectCitationBibliography: (_profile: string, _source: string, paths: string[]) => paths[0] }));
vi.mock("@/lib/tex-root", () => ({ resolveEffectiveMainDoc: () => ({ mainDoc: "main.tex" }) }));
vi.mock("@/store/files", () => ({ useFilesStore: Object.assign((select: (s: TestStore) => unknown) => select(mocks.state), { getState: () => mocks.state }) }));
import { CleanLibraryDialog } from "./CleanLibraryDialog";
const preview = { original: "old", cleaned: "new", entriesBefore: 2, entriesAfter: 1, actions: [{ kind: "renamed-key", old: "old", new: "new" }], applied: false, previewToken: "snapshot", changedFiles: ["refs.bib", "main.tex"] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { projectId: "one", files: {}, tree: [{ path: "refs.bib", is_dir: false }, { path: "other.bib", is_dir: false }], engine: { capabilities: { formatting_profile: "latex" } }, runExternalProjectMutation: mocks.mutation, flushForQuit: mocks.flush };
  mocks.flush.mockResolvedValue(undefined);
  mocks.clean.mockResolvedValue(preview);
  mocks.mutation.mockImplementation((_project, action) => action(42));
});
async function plan() {
  fireEvent.click(screen.getByTestId("clean-library-dry-run"));
  await screen.findByTestId("clean-library-apply");
}
describe("CleanLibraryDialog", () => {
  it("saves dirty buffers before previewing and stops when saving fails", async () => {
    render(<CleanLibraryDialog open onClose={vi.fn()} />);
    mocks.flush.mockRejectedValueOnce(new Error("Disk full"));
    fireEvent.click(screen.getByTestId("clean-library-dry-run"));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    expect(mocks.clean).not.toHaveBeenCalled();
    await plan();
    expect(mocks.flush.mock.invocationCallOrder[1]).toBeLessThan(mocks.clean.mock.invocationCallOrder[0]);
  });
  it("applies the reviewed token through the editor mutation barrier", async () => {
    const close = vi.fn();
    render(<CleanLibraryDialog open onClose={close} />);
    await plan();
    mocks.clean.mockResolvedValue({ ...preview, applied: true, projectState: { projectId: "one" } });
    fireEvent.click(screen.getByTestId("clean-library-apply"));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.mutation).toHaveBeenCalledOnce();
    expect(mocks.clean).toHaveBeenLastCalledWith("one", "refs.bib", true, "snapshot", 42);
  });
  it("invalidates the preview when the selected library changes", async () => {
    render(<CleanLibraryDialog open onClose={vi.fn()} />);
    await plan();
    fireEvent.click(screen.getByRole("button", { name: "other.bib" }));
    expect(screen.queryByTestId("clean-library-apply")).not.toBeInTheDocument();
    await plan();
    expect(mocks.clean).toHaveBeenLastCalledWith("one", "other.bib", false);
  });
  it("ignores an old project response and resets its selected library", async () => {
    let resolve!: (value: typeof preview) => void;
    mocks.clean.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const view = render(<CleanLibraryDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("clean-library-dry-run"));
    await waitFor(() => expect(mocks.clean).toHaveBeenCalledOnce());
    mocks.state = { ...mocks.state, projectId: "two", tree: [{ path: "new.bib", is_dir: false }] };
    view.rerender(<CleanLibraryDialog open onClose={vi.fn()} />);
    await act(async () => resolve(preview));
    expect(screen.queryByTestId("clean-library-apply")).not.toBeInTheDocument();
    expect(screen.getByTestId("clean-library-target")).toHaveTextContent("new.bib");
  });
  it("clears a stale preview after apply fails", async () => {
    render(<CleanLibraryDialog open onClose={vi.fn()} />);
    await plan();
    mocks.clean.mockRejectedValueOnce(new Error("The project changed after the preview."));
    fireEvent.click(screen.getByTestId("clean-library-apply"));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    expect(screen.queryByTestId("clean-library-apply")).not.toBeInTheDocument();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("does not allow advisory-only plans to write files", async () => {
    mocks.clean.mockResolvedValue({ ...preview, changedFiles: [], actions: [{ kind: "advisory", key: "old", field: "missing year" }] });
    render(<CleanLibraryDialog open onClose={vi.fn()} />);
    await plan();
    expect(screen.getByTestId("clean-library-apply")).toBeDisabled();
  });
});

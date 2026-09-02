// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Only the IPC boundary is mocked; the real bridge (tauri.ts) and the real
// files store run, so this covers the conflict wiring end to end in jsdom.
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFocus: vi.fn() }) }));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: vi.fn(async () => null) }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { info: vi.fn(), infoUnique: vi.fn(), success: vi.fn() },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));

import { FileTree } from "./FileTree";
import { useFilesStore } from "@/store/files";

beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    switch (command) {
      case "create_file":
        return {
          status: "conflict",
          destination: "notes.tex",
          suggested_destination: "notes (2).tex",
          generation: 0,
        };
      case "list_files":
        return [
          { path: "main.tex", is_dir: false },
          { path: "notes.tex", is_dir: false },
        ];
      case "read_file":
        return "content";
      case "project_mutation_generation":
        return 0;
      default:
        return undefined;
    }
  });
  useFilesStore.setState({
    projectId: "project",
    tree: [
      { path: "main.tex", is_dir: false },
      { path: "notes.tex", is_dir: false },
    ],
    files: {},
    openTabs: [],
    activePath: null,
  });
});

async function createDuplicate() {
  fireEvent.click(screen.getByText("main.tex"));
  fireEvent.click(screen.getByTitle("New file (in the selected folder)"));
  const input = await screen.findByPlaceholderText("New file name");
  fireEvent.change(input, { target: { value: "notes.tex" } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("FileTree create-collision dialog", () => {
  it("shows the structured conflict with the suggestion and no Replace option", async () => {
    render(<FileTree />);
    await createDuplicate();

    await screen.findByText("That name is already in use");
    expect(screen.getByText(/Creating never replaces an existing file/)).toBeTruthy();
    expect(screen.queryByText("Replace")).toBeNull();
    expect(screen.getByText("notes (2).tex")).toBeTruthy();
  });

  it("Keep both retries the create with the keep_both strategy", async () => {
    render(<FileTree />);
    await createDuplicate();
    await screen.findByText("That name is already in use");

    mocks.invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "create_file":
          return { status: "created", path: "notes (2).tex", generation: 1 };
        case "list_files":
          return [
            { path: "main.tex", is_dir: false },
            { path: "notes.tex", is_dir: false },
            { path: "notes (2).tex", is_dir: false },
          ];
        case "read_file":
          return "content";
        case "project_mutation_generation":
          return 0;
        default:
          return undefined;
      }
    });
    fireEvent.click(screen.getByText("Keep both"));

    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.some(
          ([command, args]) =>
            command === "create_file" &&
            (args as { conflictStrategy?: string }).conflictStrategy === "keep_both",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("That name is already in use")).toBeNull());
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabProjectRole } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabEditModeGet: vi.fn(),
  collabEditModeSet: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabEditModeGet: mocks.collabEditModeGet,
  collabEditModeSet: mocks.collabEditModeSet,
}));

vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError, info: vi.fn(), infoUnique: vi.fn() } }));

import { startEditMode, useEditMode } from "./edit-mode";
import { EditModeSwitch } from "./EditModeSwitch";

const copy = enCollab.suggestions.mode;
let stop: (() => void) | null = null;

function live(role: CollabProjectRole) {
  useCollabLiveStore.setState({
    projectId: "paper",
    role,
    status: { state: "online" },
    share: shareInfo({ project_id: "paper", role, account_id: ALICE_ID }),
  });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabEditModeGet.mockResolvedValue("editing");
  mocks.collabEditModeSet.mockResolvedValue(undefined);
});

afterEach(() => {
  stop?.();
  stop = null;
  useCollabLiveStore.setState({ projectId: null, role: null, status: null, share: null });
});

describe("Editing and Suggesting switch", () => {
  it("lets an owner switch to Suggesting and back", async () => {
    live("owner");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    const editing = await screen.findByRole("button", { name: copy.editing });
    expect(mocks.collabEditModeGet).toHaveBeenCalledWith("paper");
    expect(editing).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: copy.suggesting }));
    await waitFor(() => expect(mocks.collabEditModeSet).toHaveBeenCalledWith("paper", "suggesting"));
    expect(screen.getByRole("button", { name: copy.suggesting })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: copy.editing }));
    await waitFor(() => expect(mocks.collabEditModeSet).toHaveBeenLastCalledWith("paper", "editing"));
  });

  it("goes back to the mode it had when the change is refused, and says why once", async () => {
    live("editor");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    await screen.findByRole("button", { name: copy.editing });
    mocks.collabEditModeSet.mockRejectedValue({ code: "suggestion_role", message: "no" });
    fireEvent.click(screen.getByRole("button", { name: copy.suggesting }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.toastError).toHaveBeenCalledWith(enCollab.errors.suggestion_role);
    expect(useEditMode.getState().mode).toBe("editing");
  });

  it("shows a reviewer a fixed Suggesting label instead of the switch", async () => {
    mocks.collabEditModeGet.mockResolvedValue("editing");
    live("reviewer");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    expect(await screen.findByRole("status", { name: copy.reviewerHint })).toHaveTextContent(copy.suggesting);
    expect(screen.queryByRole("button", { name: copy.editing })).toBeNull();
    await waitFor(() => expect(useEditMode.getState().mode).toBe("suggesting"));
  });

  it("shows nothing to commenters and viewers and never asks for their mode", async () => {
    for (const role of ["commenter", "viewer"] as const) {
      live(role);
      stop = startEditMode();
      const view = render(<EditModeSwitch projectId="paper" />);
      await act(async () => undefined);
      expect(view.container).toBeEmptyDOMElement();
      view.unmount();
      stop();
      stop = null;
    }
    expect(mocks.collabEditModeGet).not.toHaveBeenCalled();
  });

  it("asks again when the role changes", async () => {
    live("reviewer");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    await screen.findByRole("status", { name: copy.reviewerHint });
    act(() => useCollabLiveStore.setState({ role: "editor" }));
    expect(await screen.findByRole("button", { name: copy.editing })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(2);
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabEditModeState, CollabProjectRole } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { LIVE_SEEDS, liveReset, OVERLEAF_SEED } from "../tests/fixtures";

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

function state(overrides: Partial<CollabEditModeState> = {}): CollabEditModeState {
  return { mode: "editing", switchable: true, locked: null, everyone: null, guests: null, manage: false, ...overrides };
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabEditModeGet.mockResolvedValue(state());
  mocks.collabEditModeSet.mockResolvedValue(undefined);
});

afterEach(() => {
  stop?.();
  stop = null;
  useCollabLiveStore.setState(liveReset());
});

describe.each(LIVE_SEEDS)("the Editing and Suggesting switch on the $name backend", (seed) => {
  function live(role: CollabProjectRole) {
    useCollabLiveStore.setState({ ...seed.live("paper", role), status: { state: "online" } });
  }

  it("lets an owner switch to Suggesting and back", async () => {
    let current = state();
    mocks.collabEditModeGet.mockImplementation(async () => current);
    mocks.collabEditModeSet.mockImplementation(async (_projectId: string, mode: CollabEditModeState["mode"]) => {
      current = state({ mode });
    });
    live("owner");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    const editing = await screen.findByRole("button", { name: copy.editing });
    expect(mocks.collabEditModeGet).toHaveBeenCalledWith("paper");
    expect(editing).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: copy.suggesting }));
    await waitFor(() => expect(mocks.collabEditModeSet).toHaveBeenCalledWith("paper", "suggesting", "me"));
    expect(screen.getByRole("button", { name: copy.suggesting })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: copy.editing }));
    await waitFor(() => expect(mocks.collabEditModeSet).toHaveBeenLastCalledWith("paper", "editing", "me"));
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
    mocks.collabEditModeGet.mockResolvedValue(state({ switchable: false, locked: "reviewer" }));
    live("reviewer");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    expect(await screen.findByRole("status", { name: `${copy.suggesting} ${copy.reviewerHint}` })).toHaveTextContent(copy.suggesting);
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
    await screen.findByRole("status", { name: new RegExp(copy.reviewerHint) });
    act(() => useCollabLiveStore.setState({ role: "editor" }));
    expect(await screen.findByRole("button", { name: copy.editing })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.collabEditModeGet).toHaveBeenCalledTimes(2);
  });

  it("shows nothing once the project stops being live", async () => {
    live("owner");
    stop = startEditMode();
    const view = render(<EditModeSwitch projectId="paper" />);
    await screen.findByRole("button", { name: copy.editing });
    act(() => useCollabLiveStore.setState(seed.unlive()));
    expect(view.container).toBeEmptyDOMElement();
  });
});

describe("the switch on Overleaf", () => {
  function live(role: CollabProjectRole) {
    useCollabLiveStore.setState({ ...OVERLEAF_SEED.live("paper", role), status: { state: "online" } });
  }

  it.each([
    ["everyone", copy.locked.everyone, copy.suggesting],
    ["plan", copy.locked.plan, copy.editing],
    ["server", copy.locked.server, copy.editing],
  ] as const)("shows the mode without a switch when it is locked for %s, and says why", async (locked, hint, label) => {
    mocks.collabEditModeGet.mockResolvedValue(
      state({ mode: locked === "everyone" ? "suggesting" : "editing", switchable: false, locked }),
    );
    live("editor");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    expect(await screen.findByRole("status", { name: `${label} ${hint}` })).toHaveTextContent(label);
    expect(screen.queryByRole("button", { name: copy.editing })).toBeNull();
  });

  it("reads the switch again when someone turns track changes on for everyone", async () => {
    live("editor");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    await screen.findByRole("button", { name: copy.editing });
    mocks.collabEditModeGet.mockResolvedValue(state({ mode: "suggesting", switchable: false, locked: "everyone" }));
    act(() => useCollabLiveStore.setState({ tracking: true }));
    expect(await screen.findByRole("status", { name: `${copy.suggesting} ${copy.locked.everyone}` })).toBeInTheDocument();
  });

  it("gives the owner a menu for everyone and for link guests", async () => {
    const user = userEvent.setup();
    mocks.collabEditModeGet.mockResolvedValue(state({ everyone: false, guests: true, manage: true }));
    live("owner");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    await user.click(await screen.findByRole("button", { name: copy.others }));
    const everyone = await screen.findByRole("menuitemcheckbox", { name: copy.forEveryone });
    expect(everyone).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemcheckbox", { name: copy.forGuests })).toHaveAttribute("aria-checked", "true");
    await user.click(everyone);
    await waitFor(() => expect(mocks.collabEditModeSet).toHaveBeenCalledWith("paper", "suggesting", "everyone"));
    await user.click(screen.getByRole("button", { name: copy.others }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: copy.forGuests }));
    await waitFor(() => expect(mocks.collabEditModeSet).toHaveBeenLastCalledWith("paper", "editing", "guests"));
  });

  it("keeps the menu for an owner whose own switch is locked because it is on for everyone", async () => {
    mocks.collabEditModeGet.mockResolvedValue(
      state({ mode: "suggesting", switchable: false, locked: "everyone", everyone: true, guests: null, manage: true }),
    );
    live("owner");
    stop = startEditMode();
    const user = userEvent.setup();
    render(<EditModeSwitch projectId="paper" />);
    await screen.findByRole("status", { name: `${copy.suggesting} ${copy.locked.everyone}` });
    await user.click(screen.getByRole("button", { name: copy.others }));
    expect(await screen.findByRole("menuitemcheckbox", { name: copy.forEveryone })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("menuitemcheckbox", { name: copy.forGuests })).toBeNull();
  });

  it("offers no menu to someone who can't manage it", async () => {
    mocks.collabEditModeGet.mockResolvedValue(state({ everyone: false, guests: false, manage: false }));
    live("editor");
    stop = startEditMode();
    render(<EditModeSwitch projectId="paper" />);
    await screen.findByRole("button", { name: copy.editing });
    expect(screen.queryByRole("button", { name: copy.others })).toBeNull();
  });
});

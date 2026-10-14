// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  tauri: true,
  collabPendingLinks: vi.fn(),
  onCollabOpenLink: vi.fn(),
  unlisten: vi.fn(),
  handler: null as (() => void) | null,
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => mocks.tauri,
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabPendingLinks: mocks.collabPendingLinks,
  onCollabOpenLink: mocks.onCollabOpenLink,
}));

import { useLinkInbox } from "@/components/collab/link-inbox";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { CollabLinkKeeper } from "./CollabLinkKeeper";

const OPEN = "oleafly://open?server=https%3A%2F%2Fcollab.uni.edu&project=01920000-0000-7000-8000-0000000000aa";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tauri = true;
  mocks.handler = null;
  mocks.collabPendingLinks.mockResolvedValue([]);
  mocks.onCollabOpenLink.mockImplementation(async (handler: () => void) => {
    mocks.handler = handler;
    return mocks.unlisten;
  });
  useSettingsStore.setState({ liveCollaboration: false, settingsOpen: false });
  useFilesStore.setState({ projectsLoaded: true, loading: false });
});

afterEach(() => {
  cleanup();
});

describe("CollabLinkKeeper", () => {
  it("drains the waiting links once on start, after it starts listening", async () => {
    const view = render(<CollabLinkKeeper />);
    await waitFor(() => expect(mocks.collabPendingLinks).toHaveBeenCalledOnce());
    expect(mocks.onCollabOpenLink.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.collabPendingLinks.mock.invocationCallOrder[0],
    );
    view.rerender(<CollabLinkKeeper />);
    await act(async () => {});
    expect(mocks.collabPendingLinks).toHaveBeenCalledOnce();
  });

  it("drains again each time the app hears a link arrive", async () => {
    render(<CollabLinkKeeper />);
    await waitFor(() => expect(mocks.collabPendingLinks).toHaveBeenCalledOnce());
    await act(async () => mocks.handler?.());
    expect(mocks.collabPendingLinks).toHaveBeenCalledTimes(2);
  });

  it("hands the links it drains to the link intake", async () => {
    mocks.collabPendingLinks.mockResolvedValueOnce([OPEN]);
    render(<CollabLinkKeeper />);
    expect(await screen.findByText(enCollab.links.turnedOff, {}, { timeout: 5_000 })).toBeInTheDocument();
  });

  it("hands over links that arrive later too", async () => {
    render(<CollabLinkKeeper />);
    await waitFor(() => expect(mocks.collabPendingLinks).toHaveBeenCalledOnce());
    expect(screen.queryByText(enCollab.links.turnedOff)).not.toBeInTheDocument();
    mocks.collabPendingLinks.mockResolvedValueOnce([OPEN]);
    await act(async () => mocks.handler?.());
    expect(await screen.findByText(enCollab.links.turnedOff, {}, { timeout: 5_000 })).toBeInTheDocument();
  });

  it("hands links pasted inside the app to the link intake too, and empties the paste box", async () => {
    render(<CollabLinkKeeper />);
    await waitFor(() => expect(mocks.collabPendingLinks).toHaveBeenCalledOnce());
    act(() => useLinkInbox.getState().add(OPEN));
    expect(await screen.findByText(enCollab.links.turnedOff, {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(useLinkInbox.getState().links).toEqual([]);
  });

  it("stops listening when the app root unmounts", async () => {
    const view = render(<CollabLinkKeeper />);
    await waitFor(() => expect(mocks.collabPendingLinks).toHaveBeenCalledOnce());
    view.unmount();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("lets go of a listener that starts after the app root already unmounted, and drains nothing", async () => {
    let listening: (unlisten: () => void) => void = () => undefined;
    mocks.onCollabOpenLink.mockReturnValue(new Promise((resolve) => (listening = resolve)));
    const view = render(<CollabLinkKeeper />);
    view.unmount();
    await act(async () => listening(mocks.unlisten));
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    expect(mocks.collabPendingLinks).not.toHaveBeenCalled();
  });

  it("still drains the waiting links when it cannot listen for new ones", async () => {
    mocks.onCollabOpenLink.mockRejectedValue(new Error("no event bridge"));
    render(<CollabLinkKeeper />);
    await waitFor(() => expect(mocks.collabPendingLinks).toHaveBeenCalledOnce());
  });

  it("stays off outside the desktop app", async () => {
    mocks.tauri = false;
    render(<CollabLinkKeeper />);
    await act(async () => {});
    expect(mocks.onCollabOpenLink).not.toHaveBeenCalled();
    expect(mocks.collabPendingLinks).not.toHaveBeenCalled();
  });
});

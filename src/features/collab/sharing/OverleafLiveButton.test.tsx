// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabLiveReconnectNow: vi.fn(async () => undefined),
}));
vi.mock("@/lib/overleaf-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-live")>()),
  overleafLiveConnectionDetails: vi.fn(async () => ({
    server: "https://www.overleaf.com",
    transport: "websocket",
    publicId: "P.1",
    lastRejection: null,
    pendingDocs: ["main.tex"],
  })),
}));
vi.mock("@/lib/clipboard", () => ({ writeClipboardText: vi.fn(async () => undefined) }));

import { open as openExternal } from "@tauri-apps/plugin-shell";
import { installOverleafLiveActions } from "@/lib/collab-live-bridge";
import { writeClipboardText } from "@/lib/clipboard";
import { collabLiveReconnectNow } from "@/lib/tauri-collab";
import { useOverleafNotices } from "../live/overleaf-notices";
import type { OverleafLiveProject } from "@/lib/overleaf-live";
import type { CollabLiveSyncState } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { OverleafLiveButton } from "./OverleafLiveButton";

const live = enShell.overleafLive;
const pause = vi.fn();
const resume = vi.fn(async () => undefined);

function link(change: Partial<OverleafLiveProject> = {}): OverleafLiveProject {
  return { server: "https://www.overleaf.com", remoteId: "ov1", signedIn: true, paused: false, ...change };
}

function show(state: Partial<{ backend: "overleaf" | null; status: CollabLiveSyncState | null; pending: number; overleaf: OverleafLiveProject }>) {
  useCollabLiveStore.setState({ projectId: "p1", backend: "overleaf", status: { state: "online" }, pending: 0, overleaf: link(), ...state });
  render(<OverleafLiveButton />);
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("overleaf-live-button"));
  return user;
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  pause.mockReset();
  resume.mockClear();
  installOverleafLiveActions({ pause, resume, unlink: vi.fn() });
});

describe("OverleafLiveButton", () => {
  it.each([
    ["online", { status: { state: "online" } as CollabLiveSyncState }, enCollab.sync.upToDate],
    ["connecting", { status: { state: "connecting" } as CollabLiveSyncState }, live.connecting],
    ["sending", { status: { state: "online" } as CollabLiveSyncState, pending: 2 }, live.sending],
    ["reconnecting", { status: { state: "offline", retry_in_ms: 0 } as CollabLiveSyncState }, live.reconnecting],
    ["offline with work waiting", { status: { state: "offline", retry_in_ms: 0 } as CollabLiveSyncState, pending: 3 }, enCollab.sync.offline.replace("{{number}}", "3")],
    ["paused", { backend: null, status: null, overleaf: link({ paused: true }) }, enCollab.sync.paused],
    ["signed out", { status: { state: "signed_out" } as CollabLiveSyncState }, enCollab.sync.signedOut],
  ] as const)("says the project is %s", async (_label, state, words) => {
    show(state);
    await openMenu();
    expect(screen.getByTestId("overleaf-live-status").textContent).toBe(words);
  });

  it("offers Pause anyway when some changes haven't reached Overleaf", async () => {
    pause.mockResolvedValueOnce({ paused: false, unsent: ["main.tex", "sections/intro.tex"] });
    pause.mockResolvedValueOnce({ paused: true, unsent: [] });
    show({});
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.pause }));
    const dialog = await screen.findByTestId("overleaf-pause-dialog");
    expect(within(dialog).getByText(live.pauseDialog.title)).toBeTruthy();
    expect(within(dialog).getByText("sections/intro.tex")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: live.pauseDialog.pauseAnyway }));
    await waitFor(() => expect(pause).toHaveBeenLastCalledWith("p1", true));
    await waitFor(() => expect(screen.queryByTestId("overleaf-pause-dialog")).toBeNull());
  });

  it("keeps editing live when you choose to", async () => {
    pause.mockResolvedValueOnce({ paused: false, unsent: ["main.tex"] });
    show({});
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.pause }));
    const dialog = await screen.findByTestId("overleaf-pause-dialog");
    await user.click(within(dialog).getByRole("button", { name: live.pauseDialog.keepLive }));
    await waitFor(() => expect(screen.queryByTestId("overleaf-pause-dialog")).toBeNull());
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("resumes a paused project", async () => {
    show({ backend: null, status: null, overleaf: link({ paused: true }) });
    const user = await openMenu();
    expect(screen.queryByRole("menuitem", { name: live.pause })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: live.resume }));
    expect(resume).toHaveBeenCalledWith("p1");
  });

  it("asks you to sign in when no session exists", async () => {
    const openSettingsAt = vi.spyOn(useSettingsStore.getState(), "openSettingsAt");
    show({ backend: null, status: null, overleaf: link({ signedIn: false }) });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.signIn }));
    expect(openSettingsAt).toHaveBeenCalledWith("integrations");
  });

  it("opens the project on Overleaf", async () => {
    show({});
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.open }));
    expect(openExternal).toHaveBeenCalledWith("https://www.overleaf.com/project/ov1");
  });

  it("reconnects now while offline, and only then", async () => {
    show({ status: { state: "offline", retry_in_ms: 8_000 }, pending: 2 });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.reconnectNow }));
    expect(collabLiveReconnectNow).toHaveBeenCalledOnce();
  });

  it("offers no reconnect while online", async () => {
    show({});
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: live.reconnectNow })).toBeNull();
  });

  it("counts down to the next try while offline", async () => {
    show({ status: { state: "offline", retry_in_ms: 8_000 } });
    await openMenu();
    expect(screen.getByTestId("overleaf-live-status").textContent).toBe(live.reconnecting);
    expect(screen.getByTestId("overleaf-live-status-note").textContent).toBe(
      live.reconnectingIn.replace("{{seconds}}", "8"),
    );
  });

  it("says when the last change is still unconfirmed", async () => {
    useOverleafNotices.setState({ slowAck: true });
    show({ status: { state: "online" }, pending: 1 });
    await openMenu();
    expect(screen.getByTestId("overleaf-live-status").textContent).toBe(live.sending);
    expect(screen.getByTestId("overleaf-live-status-note").textContent).toBe(live.notConfirmed);
    useOverleafNotices.setState({ slowAck: false });
  });

  it("copies the connection details", async () => {
    show({});
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.copyDetails }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledOnce());
    const copied = JSON.parse(vi.mocked(writeClipboardText).mock.calls[0][0]);
    expect(copied).toEqual({
      server: "https://www.overleaf.com",
      transport: "websocket",
      publicId: "P.1",
      lastRejection: null,
      pendingDocs: ["main.tex"],
    });
  });
});

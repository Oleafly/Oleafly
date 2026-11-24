// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

vi.mock("@/lib/system-browser", () => ({ openInSystemBrowser: vi.fn(async () => true) }));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}), logWarning: vi.fn(async () => {}) }));
vi.mock("@/lib/toast", () => ({ notifyError: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
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

import { installOverleafLiveActions } from "@/lib/collab-live-bridge";
import { writeClipboardText } from "@/lib/clipboard";
import { openInSystemBrowser } from "@/lib/system-browser";
import { collabLiveReconnectNow } from "@/lib/tauri-collab";
import { notifyError } from "@/lib/toast";
import { collabErrorText } from "../errors";
import { useOverleafNotices } from "../live/overleaf-notices";
import type { OverleafLiveProject } from "@/lib/overleaf-live";
import type { CollabLiveSyncState } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { type CollabLiveStoreState, useCollabLiveStore } from "../live/live-store";
import { OverleafLiveButton } from "./OverleafLiveButton";

const live = enShell.overleafLive;
const storeGoLiveAgain = useCollabLiveStore.getState().goLiveAgain;
const pause = vi.fn();
const resume = vi.fn(async () => undefined);

function link(change: Partial<OverleafLiveProject> = {}): OverleafLiveProject {
  return { server: "https://www.overleaf.com", remoteId: "ov1", signedIn: true, paused: false, ...change };
}

function show(state: Partial<CollabLiveStoreState>) {
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
  resume.mockReset();
  vi.mocked(notifyError).mockClear();
  installOverleafLiveActions({ pause, resume, unlink: vi.fn(), errorText: (error) => collabErrorText(error) });
  useCollabLiveStore.setState({ share: null, ended: null, refused: null, refusedParams: {}, goLiveAgain: storeGoLiveAgain });
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

  it("opens the project on Overleaf through the checked system browser", async () => {
    show({});
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.open }));
    expect(openInSystemBrowser).toHaveBeenCalledWith("https://www.overleaf.com/project/ov1");
  });

  it("says when pausing or resuming didn't work", async () => {
    pause.mockRejectedValueOnce({ code: "internal", message: "journal busy" });
    show({});
    let user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.pause }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("pause overleaf live editing", expect.anything(), enCollab.errors.internal),
    );
    cleanup();
    resume.mockRejectedValueOnce({ code: "internal", message: "journal busy" });
    show({ backend: null, status: null, overleaf: link({ paused: true }) });
    user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.resume }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("resume overleaf live editing", expect.anything(), enCollab.errors.internal),
    );
  });

  it("names the command line process when it refuses a resume", async () => {
    const refusal = { code: "live_elsewhere", message: "live elsewhere", params: { by: "cli", pid: "41" } };
    resume.mockRejectedValueOnce(refusal);
    show({ backend: null, status: null, overleaf: link({ paused: true }) });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: live.resume }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        "resume overleaf live editing",
        refusal,
        enCollab.liveElsewhere.cli.replace("{{pid}}", "41"),
      ),
    );
  });

  it("names the command line process that holds the project", async () => {
    const named = enCollab.liveElsewhere.cli.replace("{{pid}}", "41");
    const holder = { by: "cli", pid: "41" };
    show({ status: { state: "ended", reason: "failed" }, ended: "failed", refused: "live_elsewhere", refusedParams: holder });
    await openMenu();
    const notes = screen.getAllByTestId("overleaf-live-status-note").map((note) => note.textContent);
    expect(notes).toContain(named);
    expect(notes).not.toContain(enCollab.errors.live_elsewhere);
  });

  it("shows nothing for a project shared on an Oleafly Server, even with a link", () => {
    show({
      share: {
        project_id: "p1",
        server_id: "server",
        server_name: "Smith Lab",
        server_url: "https://collab.uni.edu",
        shared_project_id: "shared-1",
        role: "editor",
        link: "https://collab.uni.edu/p/shared-1",
        account_id: "alice",
      },
      backend: "server",
    });
    expect(screen.queryByTestId("overleaf-live-button")).toBeNull();
  });

  it.each(["live_elsewhere", "collab_shared", "access_ended", "failed"] as const)(
    "says why going live was refused with %s",
    async (code) => {
      const reason = code === "access_ended" ? "access_ended" : "failed";
      show({ status: { state: "ended", reason }, ended: reason, refused: code });
      await openMenu();
      const notes = screen.getAllByTestId("overleaf-live-status-note").map((note) => note.textContent);
      expect(notes).toContain(enCollab.errors[code]);
    },
  );

  it("offers to go live again after a start stopped with an error", async () => {
    const goLiveAgain = vi.fn();
    show({ status: { state: "ended", reason: "failed" }, ended: "failed", refused: "live_elsewhere", goLiveAgain });
    const user = await openMenu();
    expect(screen.getByTestId("overleaf-live-status").textContent).toBe(enCollab.sync.failed);
    await user.click(screen.getByRole("menuitem", { name: enCollab.activity.goLiveAgain }));
    expect(goLiveAgain).toHaveBeenCalledOnce();
  });

  it("ticks once a second only while it counts down to the next try", async () => {
    const ticking = vi.spyOn(window, "setInterval");
    show({});
    await openMenu();
    expect(ticking.mock.calls.filter(([, every]) => every === 1_000)).toHaveLength(0);
    cleanup();
    show({ status: { state: "offline", retry_in_ms: 8_000 } });
    await openMenu();
    expect(ticking.mock.calls.filter(([, every]) => every === 1_000).length).toBeGreaterThan(0);
    ticking.mockRestore();
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

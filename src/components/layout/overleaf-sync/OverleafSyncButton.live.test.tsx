// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  const useFilesStore = create(() => ({ projectId: "p1" as string | null, files: {} }));
  return { useFilesStore, runWithEditorMutationLease: vi.fn() };
});
vi.mock("@/components/collab/CollabSlots", () => ({
  OverleafLiveSlot: () => <div data-testid="overleaf-live-slot" />,
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import { installOverleafLiveActions, useLiveBackend } from "@/lib/collab-live-bridge";
import type { OverleafLiveProject } from "@/lib/overleaf-live";
import { useOverleafSyncStore } from "@/store/overleaf-sync";
import { OverleafSyncButton } from "./OverleafSyncButton";

const SERVER = "https://www.overleaf.com";
const live = enShell.overleafLive;

function link(change: Partial<OverleafLiveProject> = {}): OverleafLiveProject {
  return { server: SERVER, remoteId: "ov1", signedIn: true, paused: false, ...change };
}

function setSync(extra: Record<string, unknown> = {}) {
  useOverleafSyncStore.setState({
    projectId: "p1",
    status: {
      linked: true,
      server: SERVER,
      remoteId: "ov1",
      auto: false,
      lastSyncAt: null,
      tokenSaved: true,
      importedFrom: { server: SERVER, projectId: "ov1" },
      ...extra,
    },
    phase: "idle",
    conflicts: [],
    choice: [],
    error: null,
    refresh: vi.fn(async () => {}),
  } as never);
}

beforeEach(() => {
  setSync();
  useLiveBackend.setState({ projectId: null, backend: null, overleaf: null, pendingPaths: [] });
});

describe("OverleafSyncButton while live editing with Overleaf is on", () => {
  it("hands the toolbar to the live button for a linked project", () => {
    useLiveBackend.setState({ projectId: "p1", backend: "overleaf", overleaf: link() });
    render(<OverleafSyncButton />);
    expect(screen.getByTestId("overleaf-live-slot")).toBeTruthy();
    expect(screen.queryByTestId("overleaf-sync-button")).toBeNull();
  });

  it("keeps the live button for a paused project with no Git token", () => {
    setSync({ tokenSaved: false });
    useLiveBackend.setState({ projectId: "p1", backend: null, overleaf: link({ paused: true }) });
    render(<OverleafSyncButton />);
    expect(screen.getByTestId("overleaf-live-slot")).toBeTruthy();
  });

  it("shows Git sync with a paused badge and a way back to live editing when a token is linked", async () => {
    const resume = vi.fn(async () => undefined);
    const uninstall = installOverleafLiveActions({ pause: vi.fn(), resume, unlink: vi.fn() });
    useLiveBackend.setState({ projectId: "p1", backend: null, overleaf: link({ paused: true }) });
    render(<OverleafSyncButton />);
    expect(screen.getByTestId("overleaf-live-paused-badge").textContent).toBe(live.pausedBadge);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("overleaf-sync-button"));
    await user.click(await screen.findByRole("menuitem", { name: live.resume }));
    await waitFor(() => expect(resume).toHaveBeenCalledWith("p1"));
    uninstall();
  });

  it("is the plain Git sync button for another project's link", () => {
    useLiveBackend.setState({ projectId: "other", backend: "overleaf", overleaf: link() });
    render(<OverleafSyncButton />);
    expect(screen.getByTestId("overleaf-sync-button")).toBeTruthy();
    expect(screen.queryByTestId("overleaf-live-paused-badge")).toBeNull();
  });
});

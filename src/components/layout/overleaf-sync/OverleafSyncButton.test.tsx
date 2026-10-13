// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  const useFilesStore = create(() => ({
    projectId: "p1" as string | null,
    files: {} as Record<string, { dirty: boolean }>,
  }));
  return { useFilesStore, runWithEditorMutationLease: vi.fn() };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useFilesStore } from "@/store/files";
import { useOverleafSyncStore } from "@/store/overleaf-sync";
import { OverleafSyncButton } from "./OverleafSyncButton";

const SERVER = "https://www.overleaf.com";
const actions = {
  refresh: vi.fn(async () => {}),
  link: vi.fn(async () => null),
  sync: vi.fn(async () => null),
  setAuto: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  saveToken: vi.fn(async () => true),
  dismissChoice: vi.fn(),
};

function status(extra: Record<string, unknown> = {}) {
  return {
    linked: false,
    server: SERVER,
    remoteId: null,
    auto: false,
    lastSyncAt: null,
    tokenSaved: false,
    importedFrom: { server: SERVER, projectId: "ov1" },
    ...extra,
  };
}

function setSync(extra: Record<string, unknown> = {}) {
  useOverleafSyncStore.setState({
    projectId: "p1",
    status: status(),
    phase: "idle",
    conflicts: [],
    choice: [],
    error: null,
    lastReport: null,
    ...actions,
    ...extra,
  } as never);
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockClear();
  (useFilesStore as unknown as { setState: (state: unknown) => void }).setState({ projectId: "p1", files: {} });
  setSync();
});

afterEach(() => {
  vi.useRealTimers();
});

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("overleaf-sync-button"));
  return user;
}

describe("OverleafSyncButton", () => {
  it("stays hidden for projects that never came from Overleaf", () => {
    setSync({ status: status({ importedFrom: null }) });
    const { container } = render(<OverleafSyncButton />);
    expect(container).toBeEmptyDOMElement();
    expect(actions.refresh).toHaveBeenCalledWith("p1");
  });

  it("asks for a Git token before linking an imported project", async () => {
    render(<OverleafSyncButton />);
    const user = await openMenu();
    expect(screen.getByTestId("overleaf-sync-status")).toHaveTextContent("Not synced with Overleaf yet.");
    await user.click(await screen.findByTestId("overleaf-sync-link"));
    expect(await screen.findByTestId("overleaf-token-dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Open Overleaf account settings/ }));
    expect(openExternal).toHaveBeenCalledWith("https://www.overleaf.com/user/settings");
    await user.type(screen.getByTestId("overleaf-token-input"), "olp_secret_token");
    await user.click(screen.getByTestId("overleaf-token-save"));
    expect(actions.saveToken).toHaveBeenCalledWith("olp_secret_token");
    await waitFor(() => expect(actions.link).toHaveBeenCalled());
  });

  it("shows a token error and links straight away when a token is saved", async () => {
    actions.saveToken.mockImplementationOnce(async () => {
      useOverleafSyncStore.setState({ error: '@oleafly/error:{"code":"overleaf.git_token_invalid","params":{}}' });
      return false;
    });
    render(<OverleafSyncButton />);
    const user = await openMenu();
    await user.click(await screen.findByTestId("overleaf-sync-link"));
    await user.type(screen.getByTestId("overleaf-token-input"), "bad");
    await user.click(screen.getByTestId("overleaf-token-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't look like an Overleaf Git token");

    setSync({ status: status({ tokenSaved: true }) });
    await user.keyboard("{Escape}");
    await openMenu();
    await user.click(await screen.findByTestId("overleaf-sync-link"));
    expect(actions.link).toHaveBeenCalled();
  });

  it("syncs, toggles automatic sync and stops syncing when linked", async () => {
    setSync({ status: status({ linked: true, remoteId: "ov1", tokenSaved: true, auto: true, lastSyncAt: Math.floor(Date.now() / 1000) }) });
    render(<OverleafSyncButton />);
    let user = await openMenu();
    expect(screen.getByTestId("overleaf-sync-status")).toHaveTextContent("Synced just now.");
    await user.click(await screen.findByTestId("overleaf-sync-now"));
    expect(actions.sync).toHaveBeenCalledWith(null, "manual");
    user = await openMenu();
    await user.click(await screen.findByTestId("overleaf-sync-auto"));
    expect(actions.setAuto).toHaveBeenCalledWith(false);
    user = await openMenu();
    await user.click(await screen.findByTestId("overleaf-sync-unlink"));
    expect(actions.unlink).toHaveBeenCalled();
  });

  it("collects a side for every clash before applying", async () => {
    setSync({
      status: status({ linked: true, remoteId: "ov1", tokenSaved: true }),
      conflicts: ["main.tex", "refs.bib"],
    });
    render(<OverleafSyncButton />);
    const user = await openMenu();
    expect(screen.getByTestId("overleaf-sync-status")).toHaveTextContent("2 files changed on both sides.");
    await user.click(await screen.findByTestId("overleaf-sync-resolve"));
    const apply = await screen.findByTestId("overleaf-conflict-apply");
    expect(apply).toBeDisabled();
    await user.click(screen.getAllByRole("button", { name: "Mine" })[0]);
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Use all of Overleaf's" }));
    await user.click(screen.getAllByRole("button", { name: "Mine" })[1]);
    await user.click(apply);
    expect(actions.sync).toHaveBeenCalledWith({ "main.tex": "remote", "refs.bib": "local" }, "manual");
  });

  it("asks which version wins when linking finds differences", async () => {
    setSync({ status: status({ tokenSaved: true }), choice: ["main.tex"] });
    render(<OverleafSyncButton />);
    expect(await screen.findByTestId("overleaf-choice-dialog")).toHaveTextContent("main.tex");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("overleaf-choice-remote"));
    expect(actions.dismissChoice).toHaveBeenCalled();
    expect(actions.link).toHaveBeenCalledWith("remote");
  });

  it("names a failed sync and a missing token", async () => {
    setSync({
      status: status({ linked: true, remoteId: "ov1", tokenSaved: true }),
      error: '@oleafly/error:{"code":"overleaf.sync_offline","params":{}}',
    });
    const { unmount } = render(<OverleafSyncButton />);
    await openMenu();
    expect(screen.getByTestId("overleaf-sync-status")).toHaveTextContent("could not reach Overleaf");
    unmount();
    setSync({ status: status({ linked: true, remoteId: "ov1", tokenSaved: false }) });
    render(<OverleafSyncButton />);
    await openMenu();
    expect(screen.getByTestId("overleaf-sync-status")).toHaveTextContent("Add your Overleaf Git token to sync.");
  });

  it("syncs on its own only when linked, awake and idle", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    setSync({ status: status({ linked: true, remoteId: "ov1", tokenSaved: true, auto: true }) });
    render(<OverleafSyncButton />);
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    expect(actions.sync).toHaveBeenCalledWith(null, "auto");

    actions.sync.mockClear();
    (useFilesStore as unknown as { setState: (state: unknown) => void }).setState({ files: { "a.tex": { dirty: true } } });
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000);
    });
    expect(actions.sync).not.toHaveBeenCalled();
  });
});

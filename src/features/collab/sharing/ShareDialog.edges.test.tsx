// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabServer, CollabShareCheck, CollabShareInfo } from "@/lib/tauri";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { useCollabStore } from "../store";
import {
  BOB,
  BOB_ID,
  SERVER_ID,
  account,
  collabError,
  deferred,
  fill,
  libraryProject,
  projectMember,
  projectSummary,
  server,
  shareCheck,
  shareInfo,
} from "../tests/fixtures";
import { allowRadixSelect, chooseOption } from "../tests/select";

const mocks = vi.hoisted(() => ({
  collabShareInfo: vi.fn(),
  collabShareCheck: vi.fn(),
  collabShareProject: vi.fn(),
  onCollabShareProgress: vi.fn(),
  collabProjectSummary: vi.fn(),
  collabMembersList: vi.fn(),
  collabServersList: vi.fn(),
  collabCommentsStatus: vi.fn(),
  collabAccessLogStatus: vi.fn(),
  collabGuestInvitations: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabShareInfo: mocks.collabShareInfo,
  collabShareCheck: mocks.collabShareCheck,
  collabShareProject: mocks.collabShareProject,
  onCollabShareProgress: mocks.onCollabShareProgress,
  collabProjectSummary: mocks.collabProjectSummary,
  collabMembersList: mocks.collabMembersList,
  collabServersList: mocks.collabServersList,
  collabCommentsStatus: mocks.collabCommentsStatus,
  collabAccessLogStatus: mocks.collabAccessLogStatus,
  collabGuestInvitations: mocks.collabGuestInvitations,
}));

import { ShareDialog } from "./ShareDialog";

const share = enCollab.share;
const manage = enCollab.manage;
const PHYSICS_ID = "0192a0b0-0000-7000-8000-0000000000a2";
const physics = server({ server_id: PHYSICS_ID, name: "Physics Dept", url: "https://physics.uni.edu" });

function openDialog(projectId = "grant") {
  useShareDialog.setState({ projectId, fromCopy: false });
  return render(<ShareDialog projectId={projectId} />);
}

beforeAll(async () => {
  await loadNamespace("collab");
  allowRadixSelect();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onCollabShareProgress.mockResolvedValue(() => undefined);
  mocks.collabServersList.mockResolvedValue([server({ account: account({ account_id: BOB_ID }) })]);
  mocks.collabShareInfo.mockResolvedValue(null);
  mocks.collabShareCheck.mockResolvedValue(shareCheck());
  mocks.collabProjectSummary.mockResolvedValue(projectSummary());
  mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner")]);
  mocks.collabCommentsStatus.mockResolvedValue({ serverAllowed: true, projectEnabled: true, canComment: true });
  mocks.collabAccessLogStatus.mockResolvedValue({ serverAllowed: false, enabled: false });
  mocks.collabGuestInvitations.mockRejectedValue(collabError("forbidden"));
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {} });
  useFilesStore.setState({
    projectId: "grant",
    projects: [libraryProject(), libraryProject({ id: "thesis", name: "Thesis" })],
    refreshProjects: vi.fn(async () => undefined),
  });
  useCollabLiveStore.setState({ projectId: "grant", share: null });
});

afterEach(() => {
  useShareDialog.setState({ projectId: null, fromCopy: false });
});

describe("ShareDialog checking the project", () => {
  it("leaves out the excluded list when nothing is held back", async () => {
    mocks.collabShareCheck.mockResolvedValue(shareCheck({ excluded: [] }));
    openDialog();
    expect(await screen.findByText(fill(share.disclosure, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(screen.queryByText(share.excluded)).toBeNull();
    expect(screen.queryByText("main.pdf")).toBeNull();
  });

  it("lets the person pick one of several signed-in servers and checks the project on that one", async () => {
    mocks.collabServersList.mockResolvedValue([server(), physics]);
    const user = userEvent.setup();
    openDialog();
    expect(await screen.findByText(fill(share.disclosure, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(mocks.collabShareCheck).toHaveBeenLastCalledWith("grant", SERVER_ID);
    await chooseOption(user, share.serverLabel, "Physics Dept");
    expect(await screen.findByText(fill(share.disclosure, { server: "Physics Dept" }))).toBeInTheDocument();
    expect(mocks.collabShareCheck).toHaveBeenLastCalledWith("grant", PHYSICS_ID);
  });

  it("ignores a check that answers after another server was chosen", async () => {
    const stale = deferred<CollabShareCheck>();
    mocks.collabServersList.mockResolvedValue([server(), physics]);
    mocks.collabShareCheck.mockImplementation((_project: string, serverId: string) =>
      serverId === SERVER_ID ? stale.promise : Promise.resolve(shareCheck({ file_count: 7 })),
    );
    const user = userEvent.setup();
    openDialog();
    await waitFor(() => expect(mocks.collabShareCheck).toHaveBeenCalledWith("grant", SERVER_ID));
    await chooseOption(user, share.serverLabel, "Physics Dept");
    expect(await screen.findByText(fill(share.disclosure, { server: "Physics Dept" }))).toBeInTheDocument();
    await act(async () => stale.resolve(shareCheck({ file_count: 99 })));
    expect(screen.getByText(share.files).nextSibling).toHaveTextContent("7");
  });

  it("ignores a failed check from a server the person moved away from", async () => {
    const stale = deferred<CollabShareCheck>();
    mocks.collabServersList.mockResolvedValue([server(), physics]);
    mocks.collabShareCheck.mockImplementation((_project: string, serverId: string) =>
      serverId === SERVER_ID ? stale.promise : Promise.resolve(shareCheck()),
    );
    const user = userEvent.setup();
    openDialog();
    await waitFor(() => expect(mocks.collabShareCheck).toHaveBeenCalledWith("grant", SERVER_ID));
    await chooseOption(user, share.serverLabel, "Physics Dept");
    expect(await screen.findByText(fill(share.disclosure, { server: "Physics Dept" }))).toBeInTheDocument();
    await act(async () => stale.reject(collabError("unreachable")));
    expect(screen.queryByText(share.checkFailed)).toBeNull();
    expect(screen.getByRole("button", { name: share.start })).toBeEnabled();
  });

  it("explains a check that fails and runs it again on request", async () => {
    mocks.collabShareCheck.mockRejectedValueOnce(collabError("unreachable")).mockResolvedValueOnce(shareCheck());
    const user = userEvent.setup();
    openDialog();
    expect(await screen.findByText(share.checkFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unreachable)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: share.start })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText(fill(share.disclosure, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(mocks.collabShareCheck).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: share.start })).toBeEnabled();
  });

  it("offers Collaboration settings when the check finds the session has ended", async () => {
    mocks.collabShareCheck.mockRejectedValue(collabError("unauthorized"));
    const user = userEvent.setup();
    openDialog();
    expect(await screen.findByText(share.checkFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unauthorized)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: share.openSettings }));
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "collaboration" });
  });

  it("offers only Retry when the check failed for another reason", async () => {
    mocks.collabShareCheck.mockRejectedValue(collabError("unreachable"));
    openDialog();
    expect(await screen.findByText(share.checkFailed)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: share.openSettings })).toBeNull();
  });

  it("shows activity, not 0 of 0, while sharing a project with nothing to count", async () => {
    let progress: (payload: { projectId: string; done: number; total: number }) => void = () => undefined;
    mocks.onCollabShareProgress.mockImplementation(async (handler: typeof progress) => {
      progress = handler;
      return () => undefined;
    });
    mocks.collabShareCheck.mockResolvedValue(shareCheck({ file_count: 4, total_bytes: 2048 }));
    mocks.collabShareProject.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    openDialog();
    await user.click(await screen.findByRole("button", { name: share.start }));
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("data-state", "indeterminate");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText(share.preparing)).toBeInTheDocument();
    await waitFor(() => expect(mocks.onCollabShareProgress).toHaveBeenCalled());
    act(() => progress({ projectId: "grant", done: 0, total: 0 }));
    expect(screen.getByText(share.saving)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("data-state", "indeterminate");
    expect(screen.queryByText(fill(share.uploading, { done: "0", total: "0" }))).toBeNull();
  });

  it("counts figures while they upload, then says the project is being saved", async () => {
    let progress: (payload: { projectId: string; done: number; total: number }) => void = () => undefined;
    mocks.onCollabShareProgress.mockImplementation(async (handler: typeof progress) => {
      progress = handler;
      return () => undefined;
    });
    mocks.collabShareCheck.mockResolvedValue(shareCheck());
    mocks.collabShareProject.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    openDialog();
    await user.click(await screen.findByRole("button", { name: share.start }));
    await waitFor(() => expect(mocks.onCollabShareProgress).toHaveBeenCalled());
    act(() => progress({ projectId: "grant", done: 1, total: 4 }));
    expect(screen.getByText(fill(share.uploading, { done: "1", total: "4" }))).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    act(() => progress({ projectId: "grant", done: 4, total: 4 }));
    expect(screen.getByText(share.saving)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("data-state", "indeterminate");
  });
});

describe("ShareDialog loading", () => {
  it("still opens for a project missing from the library list", async () => {
    useFilesStore.setState({ projects: [] });
    openDialog();
    expect(await screen.findByRole("heading", { name: fill(share.title, { name: "" }).trim() })).toBeInTheDocument();
    expect(await screen.findByText(fill(share.disclosure, { server: "Smith Lab" }))).toBeInTheDocument();
  });

  it("waits for the server list before choosing what to show", async () => {
    let answer: (servers: CollabServer[]) => void = () => undefined;
    mocks.collabServersList.mockReturnValue(new Promise<CollabServer[]>((resolve) => (answer = resolve)));
    openDialog();
    await waitFor(() => expect(mocks.collabShareInfo).toHaveBeenCalledWith("grant"));
    await act(async () => undefined);
    expect(screen.getByText(share.loading)).toBeInTheDocument();
    expect(screen.queryByText(share.noServers)).toBeNull();
    expect(mocks.collabShareCheck).not.toHaveBeenCalled();
    await act(async () => answer([server()]));
    expect(await screen.findByText(fill(share.disclosure, { server: "Smith Lab" }))).toBeInTheDocument();
  });

  it("explains when the sharing state cannot be read and tries again", async () => {
    mocks.collabShareInfo.mockRejectedValueOnce(collabError("internal")).mockResolvedValueOnce(null);
    const user = userEvent.setup();
    openDialog();
    expect(await screen.findByText(manage.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.internal)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText(fill(share.disclosure, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(screen.queryByText(manage.loadFailed)).toBeNull();
  });

  it("keeps showing the newer project when the older one's sharing state answers late", async () => {
    const stale = deferred<CollabShareInfo | null>();
    mocks.collabShareInfo.mockImplementation((projectId: string) =>
      projectId === "grant" ? stale.promise : Promise.resolve(null),
    );
    const view = openDialog();
    await waitFor(() => expect(mocks.collabShareInfo).toHaveBeenCalledWith("grant"));
    view.rerender(<ShareDialog projectId="thesis" />);
    expect(await screen.findByRole("heading", { name: fill(share.title, { name: "Thesis" }) })).toBeInTheDocument();
    expect(await screen.findByText(fill(share.disclosure, { server: "Smith Lab" }))).toBeInTheDocument();
    await act(async () => stale.resolve(shareInfo()));
    expect(screen.queryByText(fill(manage.sharedOn, { server: "Smith Lab" }))).toBeNull();
    expect(screen.getByRole("button", { name: share.start })).toBeInTheDocument();
  });

  it("does not show an error that belongs to the project it moved away from", async () => {
    const stale = deferred<CollabShareInfo | null>();
    mocks.collabShareInfo.mockImplementation((projectId: string) =>
      projectId === "grant" ? stale.promise : Promise.resolve(null),
    );
    const view = openDialog();
    await waitFor(() => expect(mocks.collabShareInfo).toHaveBeenCalledWith("grant"));
    view.rerender(<ShareDialog projectId="thesis" />);
    expect(await screen.findByText(fill(share.disclosure, { server: "Smith Lab" }))).toBeInTheDocument();
    await act(async () => stale.reject(collabError("unauthorized")));
    expect(screen.queryByText(manage.loadFailed)).toBeNull();
    expect(screen.getByRole("button", { name: share.start })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabShareProgress } from "@/lib/tauri";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { OLEAFLY_SERVER } from "../default-server";
import { useCollabStore } from "../store";
import {
  BOB,
  BOB_ID,
  account,
  CAROL,
  SERVER_ID,
  capabilities,
  collabError,
  fill,
  libraryProject,
  person,
  projectMember,
  projectSummary,
  server,
  shareCheck,
  shareInfo,
  signedOutServer,
} from "../tests/fixtures";
import { allowRadixSelect, chooseOption } from "../tests/select";

const mocks = vi.hoisted(() => ({
  collabShareInfo: vi.fn(),
  collabShareCheck: vi.fn(),
  collabShareProject: vi.fn(),
  onCollabShareProgress: vi.fn(),
  collabProjectSummary: vi.fn(),
  collabMembersList: vi.fn(),
  collabMemberSet: vi.fn(),
  collabMemberRemove: vi.fn(),
  collabPeopleSearch: vi.fn(),
  collabLinkSharingSet: vi.fn(),
  collabStopSharing: vi.fn(),
  collabLeaveProject: vi.fn(),
  collabServersList: vi.fn(),
  collabServerProbe: vi.fn(),
  collabServerSignIn: vi.fn(),
  collabServerSignInCancel: vi.fn(),
  copyIntoLibrary: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabShareInfo: mocks.collabShareInfo,
  collabShareCheck: mocks.collabShareCheck,
  collabShareProject: mocks.collabShareProject,
  onCollabShareProgress: mocks.onCollabShareProgress,
  collabProjectSummary: mocks.collabProjectSummary,
  collabMembersList: mocks.collabMembersList,
  collabMemberSet: mocks.collabMemberSet,
  collabMemberRemove: mocks.collabMemberRemove,
  collabPeopleSearch: mocks.collabPeopleSearch,
  collabLinkSharingSet: mocks.collabLinkSharingSet,
  collabStopSharing: mocks.collabStopSharing,
  collabLeaveProject: mocks.collabLeaveProject,
  collabServersList: mocks.collabServersList,
  collabServerProbe: mocks.collabServerProbe,
  collabServerSignIn: mocks.collabServerSignIn,
  collabServerSignInCancel: mocks.collabServerSignInCancel,
}));

vi.mock("@/store/copy-into-library", () => ({ copyIntoLibrary: mocks.copyIntoLibrary }));

import { ShareDialog } from "./ShareDialog";

const share = enCollab.share;
const manage = enCollab.manage;
const roles = enCollab.projectRoles;
const refreshProjects = vi.fn(async () => undefined);
const refreshShare = vi.fn(async () => undefined);
const refreshMembers = vi.fn(async () => undefined);
let progress: ((payload: CollabShareProgress) => void) | null = null;
const unlistenProgress = vi.fn();

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
  progress = null;
  mocks.onCollabShareProgress.mockImplementation(async (handler: (payload: CollabShareProgress) => void) => {
    progress = handler;
    return unlistenProgress;
  });
  mocks.collabServersList.mockResolvedValue([server({ account: account({ account_id: BOB_ID }) })]);
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {} });
  useFilesStore.setState({ projectId: "grant", projects: [libraryProject()], refreshProjects });
  useCollabLiveStore.setState({ projectId: "grant", share: null, refreshShare, refreshMembers });
});

afterEach(() => {
  useShareDialog.setState({ projectId: null, fromCopy: false, sharing: false });
});

describe("ShareDialog before sharing", () => {
  it("checks the project on the only signed-in server, shares it with progress, then lets the owner add people", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.collabShareCheck.mockResolvedValue(shareCheck({ renamed: ["Figure:1.png"] }));
    let finish: (value: unknown) => void = () => undefined;
    mocks.collabShareProject.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mocks.collabProjectSummary.mockResolvedValue(projectSummary());
    mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner")]);
    const user = userEvent.setup();
    openDialog();

    expect(await screen.findByRole("heading", { name: fill(share.title, { name: "Grant proposal" }) })).toBeInTheDocument();
    expect(await screen.findByText(fill(share.disclosure, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(mocks.collabShareCheck).toHaveBeenCalledWith("grant", SERVER_ID);
    expect(screen.getByText(share.files).nextSibling).toHaveTextContent("12");
    expect(screen.getByText(share.size).nextSibling).toHaveTextContent("3");
    expect(screen.getByText(share.excluded)).toBeInTheDocument();
    expect(screen.getByText("main.pdf")).toBeInTheDocument();
    expect(screen.getByText(share.renamed)).toBeInTheDocument();
    expect(screen.getByText("Figure:1.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: share.start }));
    expect(mocks.collabShareProject).toHaveBeenCalledWith("grant", SERVER_ID);
    await waitFor(() => expect(progress).not.toBeNull());
    progress?.({ projectId: "other", done: 9, total: 9 });
    progress?.({ projectId: "grant", done: 3, total: 12 });
    expect(await screen.findByText(fill(share.uploading, { done: "3", total: "12" }))).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");

    finish(shareInfo());
    expect(await screen.findByText(fill(manage.sharedOn, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: manage.add.label })).toBeInTheDocument();
    expect(screen.getByTestId("collab-share-trust")).toHaveTextContent(share.trustAgain);
    expect(refreshProjects).toHaveBeenCalled();
    expect(refreshShare).toHaveBeenCalled();
    expect(unlistenProgress).toHaveBeenCalled();
  });

  it("refuses to share files over the size limit or a library in a synced folder", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.collabShareCheck.mockResolvedValue(shareCheck({ too_large: ["data/huge.csv"], cloud_synced: true }));
    openDialog();
    expect(await screen.findByText(fill(share.tooLarge, { size: "50" }))).toBeInTheDocument();
    expect(screen.getByText("data/huge.csv")).toBeInTheDocument();
    expect(screen.getByText(share.cloudSynced)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: share.start })).toBeDisabled();
  });

  it("explains a failed share and tries again", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.collabShareCheck.mockResolvedValue(shareCheck());
    mocks.collabShareProject.mockRejectedValueOnce(collabError("unreachable")).mockResolvedValueOnce(shareInfo());
    mocks.collabProjectSummary.mockResolvedValue(projectSummary());
    mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner")]);
    const user = userEvent.setup();
    openDialog();
    await user.click(await screen.findByRole("button", { name: share.start }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(share.failed);
    expect(alert).toHaveTextContent(enCollab.errors.unreachable);
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText(fill(manage.sharedOn, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(mocks.collabShareProject).toHaveBeenCalledTimes(2);
  });

  it("stays open while the files upload, so the upload can't be lost or started twice", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.collabShareCheck.mockResolvedValue(shareCheck());
    let finish: (value: unknown) => void = () => undefined;
    mocks.collabShareProject.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mocks.collabProjectSummary.mockResolvedValue(projectSummary());
    mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner")]);
    const user = userEvent.setup();
    openDialog();
    await user.click(await screen.findByRole("button", { name: share.start }));
    await waitFor(() => expect(useShareDialog.getState().sharing).toBe(true));

    const dialog = screen.getByRole("dialog");
    const header = within(dialog).getByRole("button", { name: enCommon.actions.close });
    expect(header).toBeDisabled();
    const backdrop = screen.getAllByRole("button", { name: enCommon.actions.close }).find((button) => button !== header);
    fireEvent.mouseDown(backdrop as HTMLElement);
    await user.keyboard("{Escape}");
    useShareDialog.getState().close();
    expect(useShareDialog.getState().projectId).toBe("grant");
    expect(screen.getByRole("button", { name: enCommon.actions.cancel })).toBeDisabled();

    finish(shareInfo());
    expect(await screen.findByText(fill(manage.sharedOn, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(useShareDialog.getState().sharing).toBe(false);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: enCommon.actions.close })).toBeEnabled();
    useShareDialog.getState().close();
    expect(useShareDialog.getState().projectId).toBeNull();
  });

  it("lets the dialog close again after a share fails", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.collabShareCheck.mockResolvedValue(shareCheck());
    mocks.collabShareProject.mockRejectedValueOnce(collabError("unreachable"));
    const user = userEvent.setup();
    openDialog();
    await user.click(await screen.findByRole("button", { name: share.start }));
    await screen.findByRole("alert");
    expect(useShareDialog.getState().sharing).toBe(false);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: enCommon.actions.close }));
    expect(useShareDialog.getState().projectId).toBeNull();
  });

  it("says another share of the project is still running without calling it a failure", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.collabShareCheck.mockResolvedValue(shareCheck());
    mocks.collabShareProject.mockRejectedValueOnce(collabError("share_in_progress"));
    const user = userEvent.setup();
    openDialog();
    await user.click(await screen.findByRole("button", { name: share.start }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(enCollab.errors.share_in_progress);
    expect(alert).not.toHaveTextContent(share.failed);
  });

  it("points to Collaboration settings when no server is signed in", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.collabServersList.mockResolvedValue([signedOutServer()]);
    const user = userEvent.setup();
    openDialog();
    expect(await screen.findByText(share.noServers)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: share.addOleafly })).toBeNull();
    await user.click(screen.getByRole("button", { name: share.openSettings }));
    expect(useSettingsStore.getState().settingsInitialSection).toBe("collaboration");
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useShareDialog.getState().projectId).toBeNull();
    expect(mocks.collabShareCheck).not.toHaveBeenCalled();
  });

  it("adds the Oleafly server in one click when there is no server yet, then goes on to sharing", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.collabServersList.mockResolvedValue([]);
    mocks.collabServerProbe.mockResolvedValue(capabilities({ name: OLEAFLY_SERVER.name }));
    mocks.collabServerSignIn.mockResolvedValue(server({ url: OLEAFLY_SERVER.url, name: OLEAFLY_SERVER.name }));
    mocks.collabShareCheck.mockResolvedValue(shareCheck());
    useSettingsStore.setState({ settingsOpen: false });
    const user = userEvent.setup();
    openDialog();
    expect(await screen.findByText(share.noServersYet)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: share.openSettings })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: share.addOleafly }));
    expect(mocks.collabServerProbe).toHaveBeenCalledWith(OLEAFLY_SERVER.url);
    const continueWith = fill(enCollab.addServer.continueWith, { provider: "GitHub" });
    await user.click(await screen.findByRole("button", { name: continueWith }));
    expect(mocks.collabServerSignIn).toHaveBeenCalledWith(OLEAFLY_SERVER.url, "github", undefined);
    await user.click(await screen.findByRole("button", { name: enCollab.addServer.done }));
    expect(await screen.findByText(fill(share.disclosure, { server: OLEAFLY_SERVER.name }))).toBeInTheDocument();
    expect(mocks.collabShareCheck).toHaveBeenCalledWith("grant", SERVER_ID);
    expect(screen.queryByRole("dialog", { name: fill(enCollab.addServer.doneTitle, { server: OLEAFLY_SERVER.name }) })).toBeNull();
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
  });

  it("copies an opened folder into Oleafly first, then continues with the copy", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.copyIntoLibrary.mockResolvedValue("grant-copy");
    useFilesStore.setState({
      projects: [
        libraryProject({ location: { kind: "linked", display_path: "~/Papers/grant", availability: "ok" } }),
      ],
    });
    const user = userEvent.setup();
    openDialog();
    expect(await screen.findByText(share.linked)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: share.start })).toBeNull();
    await user.click(screen.getByRole("button", { name: share.copyAndShare }));
    expect(mocks.copyIntoLibrary).toHaveBeenCalledWith("grant", "Grant proposal", { openAfterCopy: true });
    await waitFor(() => expect(useShareDialog.getState()).toMatchObject({ projectId: "grant-copy", fromCopy: true }));
  });

  it("tells the person to edit the copy once it continues", async () => {
    mocks.collabShareInfo.mockResolvedValue(null);
    mocks.collabShareCheck.mockResolvedValue(shareCheck());
    useShareDialog.setState({ projectId: "grant", fromCopy: true });
    render(<ShareDialog projectId="grant" />);
    expect(await screen.findByText(share.editCopy)).toBeInTheDocument();
  });
});

describe("ShareDialog once shared", () => {
  const owner = projectMember(BOB, "owner");
  const alice = projectMember(person(), "editor");

  beforeEach(() => {
    mocks.collabShareInfo.mockResolvedValue(shareInfo());
    mocks.collabProjectSummary.mockResolvedValue(projectSummary());
    mocks.collabMembersList.mockResolvedValue([owner, alice]);
  });

  it("lists everyone with access and lets the owner change a role or remove someone", async () => {
    mocks.collabMemberSet.mockResolvedValue(projectMember(person(), "viewer"));
    mocks.collabMemberRemove.mockResolvedValue(undefined);
    const user = userEvent.setup();
    openDialog();
    const list = await screen.findByRole("list", { name: manage.people });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Bob Smith");
    expect(rows[0]).toHaveTextContent(manage.you);
    expect(rows[0]).toHaveTextContent(roles.owner);
    expect(rows[1]).toHaveTextContent("alice@uni.edu");
    expect(screen.queryByTestId("collab-share-trust")).toBeNull();

    await chooseOption(user, fill(manage.roleLabel, { name: "Alice Chen" }), roles.viewer);
    expect(mocks.collabMemberSet).toHaveBeenCalledWith("grant", alice.person.account_id, "viewer");
    await waitFor(() => expect(refreshMembers).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: fill(manage.removeNamed, { name: "Alice Chen" }) }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(fill(manage.removeConfirm.title, { name: "Alice Chen" }));
    await user.click(within(confirm).getByRole("button", { name: manage.removeConfirm.confirm }));
    expect(mocks.collabMemberRemove).toHaveBeenCalledWith("grant", alice.person.account_id);
    await waitFor(() => expect(screen.queryByText("Alice Chen")).toBeNull());
  });

  it("finds people in the directory and adds them with the chosen role", async () => {
    mocks.collabPeopleSearch.mockResolvedValue([CAROL]);
    mocks.collabMemberSet.mockResolvedValue(projectMember(CAROL, "viewer"));
    const user = userEvent.setup();
    openDialog();
    const field = await screen.findByRole("textbox", { name: manage.add.label });
    await chooseOption(user, manage.add.roleLabel, roles.viewer);
    await user.type(field, "car");
    await waitFor(() => expect(mocks.collabPeopleSearch).toHaveBeenCalledWith("grant", "car"));
    await user.click(await screen.findByRole("button", { name: fill(manage.add.addNamed, { name: "Carol Diaz" }) }));
    expect(mocks.collabMemberSet).toHaveBeenCalledWith("grant", CAROL.account_id, "viewer");
    const list = screen.getByRole("list", { name: manage.people });
    expect(await within(list).findByText("Carol Diaz")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: manage.add.label })).toHaveValue("");
  });

  it("says when nobody matches", async () => {
    mocks.collabPeopleSearch.mockResolvedValue([]);
    const user = userEvent.setup();
    openDialog();
    await user.type(await screen.findByRole("textbox", { name: manage.add.label }), "zed");
    expect(await screen.findByText(fill(manage.add.noResultsTryEmail, { server: "Smith Lab" }))).toBeInTheDocument();
  });

  it("copies the link and turns link sharing on with a role", async () => {
    mocks.collabLinkSharingSet.mockResolvedValue(projectSummary({ link_sharing: true, link_role: "viewer" }));
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    openDialog();
    await user.click(await screen.findByRole("button", { name: manage.link.copy }));
    expect(writeText).toHaveBeenCalledWith(shareInfo().link);
    expect(await screen.findByText(manage.link.copied)).toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: manage.link.sharing });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(mocks.collabLinkSharingSet).toHaveBeenCalledWith("grant", true, "viewer");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("combobox", { name: manage.link.roleLabel })).toHaveTextContent(roles.viewer);
  });

  it("explains when the server does not allow link sharing", async () => {
    mocks.collabLinkSharingSet.mockRejectedValue(collabError("server"));
    const user = userEvent.setup();
    openDialog();
    await user.click(await screen.findByRole("switch", { name: manage.link.sharing }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.server);
    expect(screen.getByRole("switch", { name: manage.link.sharing })).toHaveAttribute("aria-checked", "false");
  });

  it("stops sharing after the owner confirms", async () => {
    mocks.collabStopSharing.mockResolvedValue(undefined);
    const user = userEvent.setup();
    openDialog();
    await user.click(await screen.findByRole("button", { name: manage.stop }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(manage.stopConfirm.description);
    await user.click(within(confirm).getByRole("button", { name: manage.stopConfirm.confirm }));
    expect(mocks.collabStopSharing).toHaveBeenCalledWith("grant");
    await waitFor(() => expect(useShareDialog.getState().projectId).toBeNull());
    expect(refreshProjects).toHaveBeenCalled();
    expect(refreshShare).toHaveBeenCalled();
  });

  it("lets an editor read the list and leave, but not change anyone", async () => {
    mocks.collabShareInfo.mockResolvedValue(shareInfo({ role: "editor", account_id: alice.person.account_id }));
    mocks.collabProjectSummary.mockResolvedValue(projectSummary({ role: "editor" }));
    mocks.collabLeaveProject.mockResolvedValue(undefined);
    const user = userEvent.setup();
    openDialog();
    const list = await screen.findByRole("list", { name: manage.people });
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent(manage.you);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("textbox", { name: manage.add.label })).toBeNull();
    expect(screen.queryByRole("switch", { name: manage.link.sharing })).toBeNull();
    expect(screen.queryByRole("button", { name: manage.stop })).toBeNull();
    await user.click(screen.getByRole("button", { name: manage.leave }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: manage.leaveConfirm.confirm }));
    expect(mocks.collabLeaveProject).toHaveBeenCalledWith("grant");
    await waitFor(() => expect(useShareDialog.getState().projectId).toBeNull());
  });

  it("offers a retry when the list cannot load", async () => {
    mocks.collabMembersList.mockRejectedValueOnce(collabError("unauthorized")).mockResolvedValue([owner, alice]);
    const user = userEvent.setup();
    openDialog();
    expect(await screen.findByText(manage.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unauthorized)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByRole("list", { name: manage.people })).toBeInTheDocument();
  });
});

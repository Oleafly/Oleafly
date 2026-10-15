// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabShareInfo } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  BOB,
  collabError,
  deferred,
  fill,
  libraryProject,
  projectSummary,
  SERVER_ID,
  server,
  shareInfo,
  signedOutServer,
} from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabCommentFilePath: vi.fn(),
  collabJoinProject: vi.fn(),
  collabJoinCancel: vi.fn(),
  collabLinkPreview: vi.fn(),
  collabOpenLink: vi.fn(),
  collabServersList: vi.fn(),
  collabServerProbe: vi.fn(),
  collabServerSignInCancel: vi.fn(),
  collabShareInfo: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

const events = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    events.set(event, handler);
    return () => events.delete(event);
  }),
}));

import { useCommentsRail } from "@/components/collab/comments-rail";
import { useComments } from "../comments/comments-store";
import { useCollabStore } from "../store";
import { useAddServerRequest } from "./add-server-request";
import { LinkIntake } from "./LinkIntake";

const PROJECT = "01920000-0000-7000-8000-0000000000aa";
const ADDRESS = "https://collab.uni.edu";
const OPEN = `oleafly://open?server=https%3A%2F%2Fcollab.uni.edu&project=${PROJECT}`;
const OPEN_SLASHED = `oleafly://open/?server=https%3A%2F%2Fcollab.uni.edu%2F&project=${PROJECT}`;
const ADD = "oleafly://server/add?url=https%3A%2F%2Fcollab.uni.edu";
const FILE = "01920000-0000-7000-8000-0000000000f1";
const THREAD = "01920000-0000-7000-8000-0000000000c1";
const COMMENT = `${OPEN}&file=${FILE}&thread=${THREAD}`;
const copy = enCollab.links;
const PREVIEW = projectSummary({
  project_id: PROJECT,
  title: "Reef survey",
  owner: { ...BOB, email: null },
  role: "editor",
  link_sharing: true,
  link_role: "editor",
});
const refreshProjects = vi.fn(async () => undefined);
const openProject = vi.fn(async (_id: string) => undefined);
const openFile = vi.fn(async (_path: string) => undefined);
const onTaken = vi.fn();

// The shared project is already on this computer as library project `id`.
function inLibrary(id: string) {
  useFilesStore.setState({
    projects: [libraryProject({ id, name: "Reef survey", shared: { server_name: "Smith Lab", role: "editor" } })],
  });
  mocks.collabShareInfo.mockImplementation(async (projectId: string) =>
    projectId === id ? shareInfo({ project_id: id, server_id: SERVER_ID, shared_project_id: PROJECT }) : null,
  );
}

async function joinWhenAsked(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog", { name: copy.confirm.title });
  await user.click(within(dialog).getByRole("button", { name: copy.confirm.join }));
}

function deliver(links: readonly string[]) {
  return render(<LinkIntake links={links} onTaken={onTaken} />);
}

function fact(dialog: HTMLElement, label: string) {
  return within(dialog).getByText(label, { selector: "dt" }).nextElementSibling;
}

function sleep(ms: number) {
  return act(() => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ liveCollaboration: true, settingsOpen: false, settingsInitialSection: "general" });
  useFilesStore.setState({
    projectsLoaded: true,
    loading: false,
    projectId: null,
    activePath: null,
    refreshProjects,
    openProject,
    openFile,
  });
  useComments.setState({ projectId: null });
  useCommentsRail.setState({ reveal: null });
  useCollabStore.setState({ servers: [server()], status: "ready", loadError: null, pending: {} });
  useAddServerRequest.setState({ url: null });
  useFilesStore.setState({ projects: [] });
  mocks.collabShareInfo.mockResolvedValue(null);
  mocks.collabServerProbe.mockReturnValue(deferred().promise);
  mocks.collabServerSignInCancel.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("LinkIntake", () => {
  it("hands every delivery back to the inbox", () => {
    deliver([OPEN, ADD]);
    expect(onTaken).toHaveBeenCalledWith(2);
  });

  it("opens a project that is already in the library", async () => {
    inLibrary("local-1");
    deliver([OPEN]);
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-1"));
    expect(mocks.collabShareInfo).toHaveBeenCalledWith("local-1");
    expect(mocks.collabJoinProject).not.toHaveBeenCalled();
    expect(refreshProjects).toHaveBeenCalled();
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
    expect(mocks.collabLinkPreview).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: copy.confirm.title })).not.toBeInTheDocument();
  });

  it("opens the comment a link points at once the project is open", async () => {
    inLibrary("local-1");
    mocks.collabCommentFilePath.mockResolvedValue("chapters/intro.tex");
    openProject.mockImplementationOnce(async (id: string) => {
      useComments.setState({ projectId: id });
    });
    deliver([COMMENT]);
    await waitFor(() =>
      expect(useCommentsRail.getState().reveal).toEqual({ path: "chapters/intro.tex", threadId: THREAD }),
    );
    expect(openProject).toHaveBeenCalledWith("local-1");
    expect(mocks.collabCommentFilePath).toHaveBeenCalledWith("local-1", FILE);
    expect(openFile).toHaveBeenCalledWith("chapters/intro.tex");
  });

  it("waits for the comments of the opened project before showing the comment", async () => {
    inLibrary("local-1");
    mocks.collabCommentFilePath.mockResolvedValue("chapters/intro.tex");
    deliver([COMMENT]);
    await waitFor(() => expect(mocks.collabCommentFilePath).toHaveBeenCalledWith("local-1", FILE));
    await sleep(100);
    expect(useCommentsRail.getState().reveal).toBeNull();
    act(() => useComments.setState({ projectId: "local-1" }));
    await waitFor(() =>
      expect(useCommentsRail.getState().reveal).toEqual({ path: "chapters/intro.tex", threadId: THREAD }),
    );
  });

  it("opens just the project when the commented file is gone", async () => {
    inLibrary("local-1");
    mocks.collabCommentFilePath.mockResolvedValue(null);
    useComments.setState({ projectId: "local-1" });
    deliver([COMMENT]);
    await waitFor(() => expect(mocks.collabCommentFilePath).toHaveBeenCalledWith("local-1", FILE));
    await sleep(50);
    expect(openProject).toHaveBeenCalledWith("local-1");
    expect(useCommentsRail.getState().reveal).toBeNull();
    expect(openFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId("collab-link-notice")).not.toBeInTheDocument();
  });

  it("opens a project already in the library while signed out without asking to sign in", async () => {
    useCollabStore.setState({ servers: [signedOutServer()] });
    inLibrary("local-1");
    deliver([OPEN]);
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-1"));
    expect(screen.queryByRole("heading", { name: enCollab.addServer.title })).not.toBeInTheDocument();
  });

  it("asks before downloading a project the person is a member of but has not opened on this computer", async () => {
    mocks.collabLinkPreview.mockResolvedValue({ ...PREVIEW, role: "viewer" });
    mocks.collabOpenLink.mockResolvedValue("local-14");
    const user = userEvent.setup();
    deliver([OPEN]);
    const dialog = await screen.findByRole("dialog", { name: copy.confirm.title });
    expect(fact(dialog, copy.confirm.role)).toHaveTextContent(enCollab.projectRoles.viewer);
    await sleep(50);
    expect(mocks.collabJoinProject).not.toHaveBeenCalled();
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: copy.confirm.join }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-14"));
  });

  it("asks before joining a project the person is not a member of yet, then joins and opens it", async () => {
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockResolvedValue("local-2");
    const user = userEvent.setup();
    deliver([OPEN]);
    const dialog = await screen.findByRole("dialog", { name: copy.confirm.title });
    expect(mocks.collabLinkPreview).toHaveBeenCalledWith(SERVER_ID, PROJECT);
    const facts = within(dialog);
    expect(facts.getByText(copy.confirm.body)).toBeInTheDocument();
    expect(fact(dialog, copy.confirm.project)).toHaveTextContent("Reef survey");
    expect(fact(dialog, copy.confirm.owner)).toHaveTextContent("Bob Smith");
    expect(fact(dialog, copy.confirm.owner)).toHaveTextContent("bobsmith");
    expect(fact(dialog, copy.confirm.server)).toHaveTextContent("Smith Lab");
    expect(fact(dialog, copy.confirm.server)).toHaveTextContent(ADDRESS);
    expect(fact(dialog, copy.confirm.role)).toHaveTextContent(enCollab.projectRoles.editor);
    await sleep(50);
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    await user.click(facts.getByRole("button", { name: copy.confirm.join }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-2"));
    expect(mocks.collabOpenLink).toHaveBeenCalledWith(OPEN);
    expect(mocks.collabOpenLink).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: copy.confirm.title })).not.toBeInTheDocument();
  });

  it("leaves everything alone when the person decides not to join", async () => {
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    const user = userEvent.setup();
    deliver([OPEN]);
    const dialog = await screen.findByRole("dialog", { name: copy.confirm.title });
    await user.click(within(dialog).getByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: copy.confirm.title })).not.toBeInTheDocument());
    await sleep(50);
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    expect(screen.queryByTestId("collab-link-notice")).not.toBeInTheDocument();
  });

  it("takes the same link again right after the person declined it", async () => {
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    const user = userEvent.setup();
    const view = deliver([OPEN]);
    const first = await screen.findByRole("dialog", { name: copy.confirm.title });
    await user.click(within(first).getByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: copy.confirm.title })).not.toBeInTheDocument());
    view.rerender(<LinkIntake links={[OPEN]} onTaken={onTaken} />);
    expect(await screen.findByRole("dialog", { name: copy.confirm.title })).toBeInTheDocument();
    expect(mocks.collabLinkPreview).toHaveBeenCalledTimes(2);
  });

  it("takes the same link again right after the person stopped its download", async () => {
    const join = deferred<string>();
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockReturnValueOnce(join.promise);
    mocks.collabJoinCancel.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const view = deliver([OPEN]);
    await joinWhenAsked(user);
    const opening = await screen.findByTestId("collab-link-opening");
    await user.click(within(opening).getByRole("button", { name: enCommon.actions.cancel }));
    await act(async () => join.reject(collabError("cancelled")));
    await waitFor(() => expect(screen.queryByTestId("collab-link-opening")).toBeNull());
    view.rerender(<LinkIntake links={[OPEN_SLASHED]} onTaken={onTaken} />);
    expect(await screen.findByRole("dialog", { name: copy.confirm.title })).toBeInTheDocument();
  });

  it("treats Escape as not joining", async () => {
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    const user = userEvent.setup();
    deliver([OPEN]);
    await screen.findByRole("dialog", { name: copy.confirm.title });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: copy.confirm.title })).not.toBeInTheDocument());
    await sleep(50);
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
  });

  it("runs the next link only after the person answers", async () => {
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    const user = userEvent.setup();
    deliver([OPEN, "oleafly://nonsense"]);
    const dialog = await screen.findByRole("dialog", { name: copy.confirm.title });
    await sleep(400);
    expect(screen.queryByText(copy.malformed)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: enCommon.actions.cancel }));
    expect(await screen.findByText(copy.malformed)).toBeInTheDocument();
  });

  it("says when the person has no access without asking first, and the message closes", async () => {
    mocks.collabLinkPreview.mockRejectedValue(collabError("not_found"));
    const user = userEvent.setup();
    deliver([OPEN]);
    expect(await screen.findByText(enCollab.library.openLink.noAccess)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: copy.confirm.title })).not.toBeInTheDocument();
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
    await user.click(within(screen.getByTestId("collab-link-notice")).getByRole("button", { name: enCommon.actions.close }));
    expect(screen.queryByText(enCollab.library.openLink.noAccess)).not.toBeInTheDocument();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("explains in words when the project cannot be looked up", async () => {
    mocks.collabLinkPreview.mockRejectedValue(collabError("unreachable"));
    deliver([OPEN]);
    expect(await screen.findByText(enCollab.errors.unreachable)).toBeInTheDocument();
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
  });

  it("says when access ends between the question and the join", async () => {
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockRejectedValue(collabError("not_found"));
    const user = userEvent.setup();
    deliver([OPEN]);
    const dialog = await screen.findByRole("dialog", { name: copy.confirm.title });
    await user.click(within(dialog).getByRole("button", { name: copy.confirm.join }));
    expect(await screen.findByText(enCollab.library.openLink.noAccess)).toBeInTheDocument();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("asks a signed-out person to sign in, then asks before joining", async () => {
    useCollabStore.setState({ servers: [signedOutServer()] });
    mocks.collabLinkPreview.mockRejectedValueOnce(collabError("unauthorized")).mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockResolvedValue("local-13");
    const user = userEvent.setup();
    deliver([OPEN]);
    await screen.findByRole("heading", { name: enCollab.addServer.title });
    act(() => useCollabStore.setState({ servers: [server()] }));
    const dialog = await screen.findByRole("dialog", { name: copy.confirm.title });
    expect(mocks.collabOpenLink).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: copy.confirm.join }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-13"));
  });

  it("explains in words when the download fails", async () => {
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockRejectedValue(collabError("unreachable"));
    const user = userEvent.setup();
    deliver([OPEN]);
    await joinWhenAsked(user);
    expect(await screen.findByText(enCollab.errors.unreachable)).toBeInTheDocument();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("says when the project is full instead of calling it a clash", async () => {
    mocks.collabLinkPreview.mockRejectedValue(
      collabError("project_full", "A project on this server can have at most 20 people."),
    );
    deliver([OPEN]);
    expect(await screen.findByText(enCollab.errors.project_full)).toBeInTheDocument();
    expect(screen.queryByText(enCollab.errors.conflict)).not.toBeInTheDocument();
  });

  it("says when the project's owner is away instead of calling it missing", async () => {
    mocks.collabLinkPreview.mockRejectedValue(collabError("owner_away", "The owner is suspended."));
    deliver([OPEN]);
    expect(await screen.findByText(enCollab.errors.owner_away)).toBeInTheDocument();
    expect(screen.queryByText(enCollab.library.openLink.noAccess)).not.toBeInTheDocument();
  });

  it("says to move a library a cloud service syncs before joining", async () => {
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockRejectedValue(collabError("cloud_synced", "library is synced"));
    const user = userEvent.setup();
    deliver([OPEN]);
    await joinWhenAsked(user);
    expect(await screen.findByText(enCollab.errors.cloud_synced)).toBeInTheDocument();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("shows the server's own sentence for a refusal it has no code for", async () => {
    mocks.collabLinkPreview.mockRejectedValue(collabError("invalid", "That invitation was withdrawn."));
    deliver([OPEN]);
    expect(await screen.findByText("That invitation was withdrawn.")).toBeInTheDocument();
  });

  it("explains when the server list cannot be read", async () => {
    useCollabStore.setState({ servers: [], status: "idle" });
    mocks.collabServersList.mockRejectedValue(collabError("internal"));
    deliver([OPEN]);
    expect(await screen.findByText(enCollab.errors.internal)).toBeInTheDocument();
    expect(mocks.collabJoinProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: enCollab.addServer.title })).not.toBeInTheDocument();
  });

  it("shows that the project is opening while it downloads", async () => {
    const join = deferred<string>();
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockReturnValue(join.promise);
    const user = userEvent.setup();
    deliver([OPEN]);
    await joinWhenAsked(user);
    expect(await screen.findByText(copy.opening)).toBeInTheDocument();
    await act(async () => join.resolve("local-3"));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-3"));
    expect(screen.queryByText(copy.opening)).not.toBeInTheDocument();
  });

  it("shows how far the download got and stops it with Cancel, without an error", async () => {
    const user = userEvent.setup();
    const join = deferred<string>();
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockReturnValue(join.promise);
    mocks.collabJoinCancel.mockResolvedValue(undefined);
    deliver([OPEN]);
    await joinWhenAsked(user);
    const opening = await screen.findByTestId("collab-link-opening");
    expect(within(opening).getByRole("progressbar")).toHaveAttribute("data-state", "indeterminate");
    await waitFor(() => expect(events.has("collab-join-progress")).toBe(true));
    const report = (sharedProjectId: string, done: number, total: number) =>
      act(() => events.get("collab-join-progress")?.({ payload: { serverId: SERVER_ID, sharedProjectId, done, total } }));
    report(PROJECT, 3, 12);
    const downloading = fill(copy.downloading, { done: "3", total: "12" });
    expect(within(opening).getByRole("status")).toHaveTextContent(downloading);
    expect(within(opening).getByRole("progressbar", { name: downloading })).toHaveAttribute("aria-valuenow", "25");
    report("01920000-0000-7000-8000-0000000000bb", 9, 9);
    expect(within(opening).getByText(fill(copy.downloading, { done: "3", total: "12" }))).toBeInTheDocument();
    await user.click(within(opening).getByRole("button", { name: enCommon.actions.cancel }));
    expect(mocks.collabJoinCancel).toHaveBeenCalledWith(SERVER_ID, PROJECT);
    expect(within(opening).getByRole("status")).toHaveTextContent(copy.cancelling);
    expect(within(opening).getByRole("button", { name: enCommon.actions.cancel })).toBeDisabled();
    await act(async () => join.reject(collabError("cancelled")));
    await waitFor(() => expect(screen.queryByTestId("collab-link-opening")).toBeNull());
    expect(screen.queryByTestId("collab-link-notice")).toBeNull();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("adds an unknown server first, then opens the project", async () => {
    useCollabStore.setState({ servers: [] });
    mocks.collabLinkPreview.mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockResolvedValue("local-4");
    const user = userEvent.setup();
    deliver([OPEN]);
    expect(await screen.findByRole("textbox", { name: enCollab.addServer.addressLabel })).toHaveValue(ADDRESS);
    expect(mocks.collabServerProbe).toHaveBeenCalledWith(ADDRESS);
    expect(mocks.collabLinkPreview).not.toHaveBeenCalled();
    act(() => useCollabStore.setState({ servers: [server()] }));
    await joinWhenAsked(user);
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-4"));
    expect(mocks.collabLinkPreview).toHaveBeenCalledWith(SERVER_ID, PROJECT);
    expect(screen.queryByRole("heading", { name: enCollab.addServer.title })).not.toBeInTheDocument();
  });

  it("keeps the Add server step open until the new server is signed in", async () => {
    useCollabStore.setState({ servers: [] });
    inLibrary("local-7");
    deliver([OPEN]);
    await screen.findByRole("heading", { name: enCollab.addServer.title });
    act(() => useCollabStore.setState({ servers: [signedOutServer()] }));
    await sleep(50);
    expect(mocks.collabShareInfo).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: enCollab.addServer.title })).toBeInTheDocument();
    act(() => useCollabStore.setState({ servers: [server()] }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-7"));
  });

  it("stops quietly when the person closes the Add server step", async () => {
    useCollabStore.setState({ servers: [] });
    const user = userEvent.setup();
    deliver([OPEN]);
    await screen.findByRole("heading", { name: enCollab.addServer.title });
    await user.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: enCollab.addServer.title })).not.toBeInTheDocument(),
    );
    act(() => useCollabStore.setState({ servers: [server()] }));
    await sleep(50);
    expect(mocks.collabLinkPreview).not.toHaveBeenCalled();
    expect(screen.queryByTestId("collab-link-notice")).not.toBeInTheDocument();
  });

  it("asks a signed-out person to sign in, then opens the project", async () => {
    useCollabStore.setState({ servers: [signedOutServer()] });
    mocks.collabLinkPreview.mockRejectedValueOnce(collabError("unauthorized")).mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockResolvedValue("local-5");
    const user = userEvent.setup();
    deliver([OPEN]);
    expect(await screen.findByRole("textbox", { name: enCollab.addServer.addressLabel })).toHaveValue(ADDRESS);
    expect(openProject).not.toHaveBeenCalled();
    act(() => useCollabStore.setState({ servers: [server()] }));
    await joinWhenAsked(user);
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-5"));
    expect(mocks.collabLinkPreview).toHaveBeenCalledTimes(2);
  });

  it("asks to sign in again when the session ran out, waiting for the new sign-in", async () => {
    mocks.collabLinkPreview.mockRejectedValueOnce(collabError("unauthorized")).mockResolvedValue(PREVIEW);
    mocks.collabOpenLink.mockResolvedValue("local-6");
    const user = userEvent.setup();
    deliver([OPEN]);
    await screen.findByRole("heading", { name: enCollab.addServer.title });
    await sleep(50);
    expect(mocks.collabLinkPreview).toHaveBeenCalledTimes(1);
    act(() => useCollabStore.setState({ servers: [server({ name: "Smith Lab again" })] }));
    await joinWhenAsked(user);
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-6"));
  });

  it("asks to sign in only once per link and then says what went wrong", async () => {
    mocks.collabLinkPreview.mockRejectedValue(collabError("unauthorized"));
    deliver([OPEN]);
    await screen.findByRole("heading", { name: enCollab.addServer.title });
    act(() => useCollabStore.setState({ servers: [server({ name: "Smith Lab again" })] }));
    expect(await screen.findByText(enCollab.errors.unauthorized)).toBeInTheDocument();
    expect(mocks.collabLinkPreview).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", { name: enCollab.addServer.title })).not.toBeInTheDocument();
  });

  it("asks a signed-out person to sign in with the address the app already knows", async () => {
    useCollabStore.setState({ servers: [signedOutServer()] });
    deliver(["oleafly://server/add?url=https%3A%2F%2FCollab.Uni.edu%2F"]);
    await waitFor(() => expect(useSettingsStore.getState().settingsOpen).toBe(true));
    expect(useAddServerRequest.getState().url).toBe(ADDRESS);
  });

  it("sends an Add to Oleafly link to Collaboration settings with the address filled in", async () => {
    useCollabStore.setState({ servers: [] });
    deliver([ADD]);
    await waitFor(() => expect(useSettingsStore.getState().settingsOpen).toBe(true));
    expect(useSettingsStore.getState().settingsInitialSection).toBe("collaboration");
    expect(useAddServerRequest.getState().url).toBe(ADDRESS);
  });

  it("opens Collaboration settings for a server that is already signed in without asking again", async () => {
    deliver([ADD]);
    await waitFor(() => expect(useSettingsStore.getState().settingsOpen).toBe(true));
    expect(useSettingsStore.getState().settingsInitialSection).toBe("collaboration");
    expect(useAddServerRequest.getState().url).toBeNull();
  });

  it("says in one line that live collaboration is off and opens that setting", async () => {
    useSettingsStore.setState({ liveCollaboration: false });
    const user = userEvent.setup();
    deliver([OPEN, ADD, "oleafly://nonsense"]);
    expect(await screen.findByText(copy.turnedOff)).toBeInTheDocument();
    expect(screen.getAllByTestId("collab-link-notice")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: copy.openSettings }));
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "experimentation" });
    expect(screen.queryByText(copy.turnedOff)).not.toBeInTheDocument();
    await sleep(400);
    expect(screen.queryByTestId("collab-link-notice")).not.toBeInTheDocument();
    expect(mocks.collabJoinProject).not.toHaveBeenCalled();
    expect(useAddServerRequest.getState().url).toBeNull();
  });

  it("shows one quiet message for a link Oleafly cannot read", async () => {
    deliver(["oleafly://open?path=/srv/thesis"]);
    expect(await screen.findByText(copy.malformed)).toBeInTheDocument();
    expect(mocks.collabJoinProject).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
  });

  it("runs duplicate deliveries of the same link once", async () => {
    const looked = deferred<CollabShareInfo | null>();
    inLibrary("local-7");
    mocks.collabShareInfo.mockReturnValue(looked.promise);
    const view = deliver([OPEN, OPEN_SLASHED, OPEN]);
    await waitFor(() => expect(mocks.collabShareInfo).toHaveBeenCalledTimes(1));
    view.rerender(<LinkIntake links={[OPEN]} onTaken={onTaken} />);
    await act(async () =>
      looked.resolve(shareInfo({ project_id: "local-7", server_id: SERVER_ID, shared_project_id: PROJECT })),
    );
    await waitFor(() => expect(openProject).toHaveBeenCalledOnce());
    view.rerender(<LinkIntake links={[OPEN_SLASHED]} onTaken={onTaken} />);
    await sleep(400);
    expect(mocks.collabShareInfo).toHaveBeenCalledTimes(1);
    expect(openProject).toHaveBeenCalledOnce();
  });

  it("waits while a dialog is open and runs the link once it closes", async () => {
    inLibrary("local-8");
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    deliver([OPEN]);
    await sleep(600);
    expect(mocks.collabShareInfo).not.toHaveBeenCalled();
    modal.remove();
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-8"));
    await sleep(400);
    expect(mocks.collabShareInfo).toHaveBeenCalledOnce();
  });

  it("waits until the library has loaded", async () => {
    inLibrary("local-9");
    useFilesStore.setState({ projectsLoaded: false });
    deliver([OPEN]);
    await sleep(400);
    expect(mocks.collabShareInfo).not.toHaveBeenCalled();
    act(() => useFilesStore.setState({ projectsLoaded: true }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-9"));
    expect(mocks.collabShareInfo).toHaveBeenCalledOnce();
  });

  it("waits while a project is opening", async () => {
    inLibrary("local-10");
    useFilesStore.setState({ loading: true });
    deliver([OPEN]);
    await sleep(400);
    expect(mocks.collabShareInfo).not.toHaveBeenCalled();
    act(() => useFilesStore.setState({ loading: false }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-10"));
  });

  it("leaves the project alone when it is already open", async () => {
    useFilesStore.setState({ projectId: "local-11" });
    inLibrary("local-11");
    deliver([OPEN]);
    await waitFor(() => expect(mocks.collabShareInfo).toHaveBeenCalledOnce());
    await sleep(50);
    expect(openProject).not.toHaveBeenCalled();
  });

  it("runs the next link after the person closes the message for the first", async () => {
    inLibrary("local-12");
    const user = userEvent.setup();
    deliver(["oleafly://nonsense", OPEN]);
    expect(await screen.findByText(copy.malformed)).toBeInTheDocument();
    await sleep(400);
    expect(mocks.collabShareInfo).not.toHaveBeenCalled();
    await user.click(within(screen.getByTestId("collab-link-notice")).getByRole("button", { name: enCommon.actions.close }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("local-12"));
  });
});

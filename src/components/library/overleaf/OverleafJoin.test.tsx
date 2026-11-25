// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafListProjects: vi.fn(),
  overleafImportProjects: vi.fn(),
  overleafOpenLive: vi.fn(),
  overleafInviteAccept: vi.fn(),
  overleafLinkPreview: vi.fn(),
  overleafLinkJoin: vi.fn(),
  overleafSignInBrowsers: vi.fn(async () => []),
}));
const files = vi.hoisted(() => ({ refreshProjects: vi.fn(async () => {}) }));
const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/lib/log", () => log);
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));

import { looksLikeOverleafLink } from "@/lib/overleaf";
import { useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";
import { OverleafImportView } from "./OverleafImportView";

const SERVER = "https://www.overleaf.com";
const signedIn = { server: SERVER, signedIn: true, email: "ada@uni.edu", userId: "u-ada", accounts: [] };
const READ_LINK = "https://www.overleaf.com/read/qwertyuiopas";

function project(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    ownerName: "Ada Lovelace",
    owned: true,
    access: "owner",
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: null,
    archived: false,
    importedAs: null,
    ...extra,
  };
}

const INVITE = {
  id: "inv1",
  projectId: "p9",
  projectName: "Grant proposal",
  inviter: "Grace",
  expires: null,
};

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.overleafSignInBrowsers.mockResolvedValue([]);
  files.refreshProjects.mockClear();
  log.logError.mockClear();
  localStorage.clear();
  useOverleafImportStore.setState({
    server: SERVER,
    status: null,
    projects: [],
    invites: [],
    accepting: null,
    inviteFailed: null,
    phase: "idle",
    error: null,
    selected: [],
    progress: {},
    importing: false,
    run: null,
  });
  useOverleafImportStore.getState().setLayout("list");
  useSettingsStore.setState({ overleafLive: true });
  api.overleafStatus.mockResolvedValue(signedIn);
  api.overleafListProjects.mockResolvedValue({
    status: signedIn,
    projects: [project("a1", "Thesis"), project("c3", "Old notes", { importedAs: "local-c3" })],
    invites: [],
  });
});

function search(text: string) {
  fireEvent.change(screen.getByTestId("overleaf-search"), { target: { value: text } });
}

describe("open live, invitations and links", () => {
  it("opens a project live without importing it and only when the experimental switch is on", async () => {
    const onOpenProject = vi.fn();
    api.overleafOpenLive.mockResolvedValue({ projectId: "local-a1", reused: false });
    const { unmount } = render(<OverleafImportView onOpenProject={onOpenProject} onDone={vi.fn()} />);
    await screen.findByTestId("overleaf-import-view");
    expect(screen.queryByTestId("overleaf-open-live-c3")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-open-live-a1"));

    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("local-a1"));
    expect(api.overleafOpenLive).toHaveBeenCalledWith(SERVER, "a1", "u-ada");
    expect(api.overleafImportProjects).not.toHaveBeenCalled();
    expect(files.refreshProjects).toHaveBeenCalled();
    expect(useOverleafImportStore.getState().projects.find((entry) => entry.id === "a1")?.importedAs).toBe("local-a1");
    unmount();

    useSettingsStore.setState({ overleafLive: false });
    useOverleafImportStore.setState({ phase: "idle" });
    render(<OverleafImportView onOpenProject={onOpenProject} onDone={vi.fn()} />);
    await screen.findByTestId("overleaf-import-view");
    expect(screen.queryByTestId("overleaf-open-live-a1")).not.toBeInTheDocument();
  });

  it("names the project on every button that acts on one", async () => {
    api.overleafListProjects.mockResolvedValue({
      status: signedIn,
      projects: [project("a1", "Thesis"), project("b2", "Paper"), project("c3", "Old notes", { importedAs: "local-c3" })],
      invites: [INVITE, { ...INVITE, id: "inv2", projectId: "p8", projectName: "Survey" }],
    });
    api.overleafInviteAccept.mockResolvedValue({ server: SERVER, projectId: "p9" });
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    await screen.findByTestId("overleaf-import-view");
    expect(screen.getByTestId("overleaf-open-live-a1")).toHaveAccessibleName("Open live Thesis");
    expect(screen.getByTestId("overleaf-open-live-b2")).toHaveAccessibleName("Open live Paper");
    expect(within(screen.getByTestId("overleaf-status-c3")).getByRole("button")).toHaveAccessibleName("Open Old notes");
    expect(screen.getByTestId("overleaf-invite-join-inv1")).toHaveAccessibleName("Join Grant proposal");
    expect(screen.getByTestId("overleaf-invite-join-inv2")).toHaveAccessibleName("Join Survey");
    fireEvent.click(screen.getByTestId("overleaf-invite-join-inv1"));
    const joined = await screen.findByTestId("overleaf-joined-p9");
    expect(within(joined).getByRole("button")).toHaveAccessibleName("Open live Grant proposal");
  });

  it("shows a failed open with a retry that opens live again", async () => {
    api.overleafOpenLive.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ projectId: "local-a1", reused: false });
    const onOpenProject = vi.fn();
    render(<OverleafImportView onOpenProject={onOpenProject} onDone={vi.fn()} />);
    await screen.findByTestId("overleaf-import-view");
    fireEvent.click(screen.getByTestId("overleaf-open-live-a1"));
    const status = await screen.findByTestId("overleaf-status-a1");
    fireEvent.click(await within(status).findByRole("button", { name: "Try again Thesis" }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("local-a1"));
    expect(api.overleafOpenLive).toHaveBeenCalledTimes(2);
    expect(api.overleafImportProjects).not.toHaveBeenCalled();
  });

  it("lists invitations above the projects, joins one, then offers to open it live", async () => {
    api.overleafListProjects
      .mockResolvedValueOnce({ status: signedIn, projects: [project("a1", "Thesis")], invites: [INVITE] })
      .mockResolvedValueOnce({
        status: signedIn,
        projects: [project("a1", "Thesis"), project("p9", "Grant proposal", { owned: false })],
        invites: [],
      });
    api.overleafInviteAccept.mockResolvedValue({ server: SERVER, projectId: "p9" });
    api.overleafOpenLive.mockResolvedValue({ projectId: "local-p9", reused: false });
    const onOpenProject = vi.fn();
    render(<OverleafImportView onOpenProject={onOpenProject} onDone={vi.fn()} />);
    const section = await screen.findByTestId("overleaf-invitations");
    expect(within(section).getByText("Grant proposal")).toBeInTheDocument();
    expect(within(section).getByText("From Grace")).toBeInTheDocument();
    fireEvent.click(within(section).getByTestId("overleaf-invite-join-inv1"));

    await waitFor(() => expect(api.overleafInviteAccept).toHaveBeenCalledWith(SERVER, "inv1", "u-ada"));
    const joined = await screen.findByTestId("overleaf-joined-p9");
    fireEvent.click(within(joined).getByTestId("overleaf-joined-open-live-p9"));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("local-p9"));
  });

  it("previews a pasted link, says what joining grants and grants nothing before Join", async () => {
    api.overleafLinkPreview.mockResolvedValue({ server: SERVER, projectName: "Shared draft", grants: "view", projectId: null });
    api.overleafLinkJoin.mockResolvedValue({ server: SERVER, projectId: "p7" });
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    await screen.findByTestId("overleaf-import-view");
    search(READ_LINK);

    const card = await screen.findByTestId("overleaf-link-preview");
    await within(card).findByText("Shared draft");
    expect(within(card).getByTestId("overleaf-link-grants")).toHaveTextContent(
      "Joining lets you view it only. Link viewers get no comments or chat.",
    );
    expect(api.overleafLinkPreview).toHaveBeenCalledTimes(1);
    expect(api.overleafLinkPreview).toHaveBeenCalledWith(SERVER, READ_LINK, "u-ada");
    expect(api.overleafLinkJoin).not.toHaveBeenCalled();
    expect(within(screen.getByTestId("overleaf-project-a1")).getByRole("button", { name: "Select Thesis" })).toBeInTheDocument();
    expect(within(card).getByTestId("overleaf-link-join")).toHaveAccessibleName("Join Shared draft");

    fireEvent.click(within(card).getByTestId("overleaf-link-join"));
    await waitFor(() => expect(api.overleafLinkJoin).toHaveBeenCalledWith(SERVER, READ_LINK, "u-ada"));
    expect(await within(card).findByTestId("overleaf-joined-open-live-p7")).toBeInTheDocument();
  });

  it("says a link that opens nothing is not usable without logging it as a failure", async () => {
    api.overleafLinkPreview.mockRejectedValue('@oleafly/error:{"code":"overleaf.link_unavailable"}');
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    await screen.findByTestId("overleaf-import-view");
    search(READ_LINK);
    const card = await screen.findByTestId("overleaf-link-preview");
    expect(await within(card).findByRole("alert")).toHaveTextContent("This link doesn't open a project anymore.");
    expect(within(card).queryByTestId("overleaf-link-join")).not.toBeInTheDocument();
    expect(log.logError).not.toHaveBeenCalled();
  });

  it("tells pasted links from searches", () => {
    expect(looksLikeOverleafLink(READ_LINK)).toBe(true);
    expect(looksLikeOverleafLink("https://www.overleaf.com/4815162342asdfghjklzxc#a1b2c3")).toBe(true);
    expect(looksLikeOverleafLink("https://www.overleaf.com/project/6af9a1b2c3d4e5f6a7b8c9d0")).toBe(true);
    expect(looksLikeOverleafLink("thesis draft")).toBe(false);
    expect(looksLikeOverleafLink("https://www.overleaf.com/learn")).toBe(false);
  });
});

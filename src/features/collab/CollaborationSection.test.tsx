// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { account, capabilities, collabError, fill, libraryProject, server, signedOutServer } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabServersList: vi.fn(),
  collabServerProbe: vi.fn(),
  collabServerSignIn: vi.fn(),
  collabServerSignInCancel: vi.fn(),
  collabServerSignOut: vi.fn(),
  collabServerRemove: vi.fn(),
  collabServerDevices: vi.fn(),
  collabServerSignOutDevice: vi.fn(),
  collabServerTest: vi.fn(),
  collabAdminMembers: vi.fn(),
  collabServerRefresh: vi.fn(),
  onCollabServerChanged: vi.fn(),
  serverChanged: null as (() => void) | null,
}));

const events = vi.hoisted(() => ({ useTauriEvent: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));
vi.mock("@/hooks/use-tauri-event", () => ({ useTauriEvent: events.useTauriEvent }));

import { CollaborationSection } from "./CollaborationSection";
import { useCollabStore } from "./store";

const copy = enCollab.section;

beforeAll(async () => {
  await loadNamespace("collab");
  await loadNamespace("native");
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {}, detached: [] });
  useFilesStore.setState({ projects: [] });
  mocks.collabServerDevices.mockResolvedValue([]);
  mocks.serverChanged = null;
  mocks.onCollabServerChanged.mockImplementation(async (handler: () => void) => {
    mocks.serverChanged = handler;
    return () => {
      if (mocks.serverChanged === handler) mocks.serverChanged = null;
    };
  });
  mocks.collabServerRefresh.mockImplementation(async (serverId: string) =>
    useCollabStore.getState().servers.find((entry) => entry.server_id === serverId),
  );
});

describe("CollaborationSection", () => {
  it("lists each server with its address and sign-in state", async () => {
    mocks.collabServersList.mockResolvedValue([
      server(),
      signedOutServer({
        server_id: "0192a0b0-0000-7000-8000-0000000000b2",
        name: "Jones Lab",
        url: "https://jones.example.edu",
      }),
    ]);
    render(<CollaborationSection />);
    expect(screen.getByText(copy.intro)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Smith Lab" })).toBeInTheDocument();
    expect(screen.getByText("https://collab.uni.edu")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Jones Lab" })).toBeInTheDocument();
    expect(screen.getByText(copy.server.signedIn)).toBeInTheDocument();
    expect(screen.getByText(copy.server.signedOut)).toBeInTheDocument();
  });

  it("names the shared projects a removed server left behind as ordinary projects", async () => {
    mocks.collabServersList.mockResolvedValue([server()]);
    mocks.collabServerRemove.mockResolvedValue({
      signed_out: true,
      unsent: [],
      detached: [
        { project_id: "thesis", name: "Thesis" },
        { project_id: "grant", name: "Grant proposal" },
      ],
    });
    const user = userEvent.setup();
    render(<CollaborationSection />);
    await user.click(await screen.findByRole("button", { name: copy.server.remove }));
    await user.click(screen.getByRole("button", { name: copy.server.removeConfirm.confirm }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(copy.server.detached.replace("{{server}}", "Smith Lab"));
    expect(within(notice).getByText("Thesis")).toBeInTheDocument();
    expect(within(notice).getByText(fill(copy.server.unsent.staysAs, { name: "Thesis (local copy)" }))).toBeInTheDocument();
    expect(within(notice).getByText("Grant proposal")).toBeInTheDocument();
    await user.click(within(notice).getByRole("button", { name: enCommon.actions.ok }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the local copy as the library calls it once the library has the new name", async () => {
    useFilesStore.setState({ projects: [libraryProject({ id: "thesis", name: "Thesis (local copy 2)" })] });
    useCollabStore.setState({ detached: [{ server: "Smith Lab", projects: [{ project_id: "thesis", name: "Thesis" }] }] });
    mocks.collabServersList.mockResolvedValue([]);
    render(<CollaborationSection />);
    const notice = await screen.findByRole("status");
    expect(within(notice).getByText(fill(copy.server.unsent.staysAs, { name: "Thesis (local copy 2)" }))).toBeInTheDocument();
  });

  it("forgets what a Remove left behind once Settings closes", async () => {
    useCollabStore.setState({ detached: [{ server: "Smith Lab", projects: [{ project_id: "thesis", name: "Thesis" }] }] });
    mocks.collabServersList.mockResolvedValue([]);
    const view = render(<CollaborationSection />);
    expect(await screen.findByRole("status")).toBeInTheDocument();
    view.unmount();
    expect(useCollabStore.getState().detached).toEqual([]);
  });

  it("says in the Remove question that the projects become local copies", async () => {
    mocks.collabServersList.mockResolvedValue([server()]);
    const user = userEvent.setup();
    render(<CollaborationSection />);
    await user.click(await screen.findByRole("button", { name: copy.server.remove }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      fill(copy.server.removeConfirm.description, { name: "Smith Lab" }),
    );
  });

  it("shows what to do when there are no servers", async () => {
    mocks.collabServersList.mockResolvedValue([]);
    render(<CollaborationSection />);
    expect(screen.getByText(copy.servers.loading)).toBeInTheDocument();
    expect(await screen.findByText(copy.servers.empty.title)).toBeInTheDocument();
    expect(screen.getByText(copy.servers.empty.description)).toBeInTheDocument();
  });

  it("explains a failed load and tries again", async () => {
    mocks.collabServersList.mockRejectedValueOnce(collabError("internal")).mockResolvedValueOnce([server()]);
    const user = userEvent.setup();
    render(<CollaborationSection />);
    expect(await screen.findByText(copy.servers.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.internal)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByRole("heading", { name: "Smith Lab" })).toBeInTheDocument();
  });

  it("reloads when the backend says a server changed", async () => {
    mocks.collabServersList.mockResolvedValueOnce([]).mockResolvedValueOnce([server()]);
    render(<CollaborationSection />);
    await screen.findByText(copy.servers.empty.title);
    await waitFor(() => expect(mocks.serverChanged).not.toBeNull());
    act(() => mocks.serverChanged?.());
    expect(await screen.findByRole("heading", { name: "Smith Lab" })).toBeInTheDocument();
    expect(mocks.onCollabServerChanged).toHaveBeenCalledTimes(1);
  });

  it("opens Add server", async () => {
    mocks.collabServersList.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<CollaborationSection />);
    await user.click(await screen.findByRole("button", { name: copy.servers.add }));
    expect(await screen.findByRole("dialog", { name: enCollab.addServer.title })).toBeInTheDocument();
    expect(mocks.collabServerProbe).not.toHaveBeenCalled();
  });

  it("opens Add server at the server's own address to sign in again", async () => {
    mocks.collabServersList.mockResolvedValue([signedOutServer()]);
    mocks.collabServerProbe.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    render(<CollaborationSection />);
    await user.click(await screen.findByRole("button", { name: copy.server.signIn }));
    expect(await screen.findByRole("dialog", { name: enCollab.addServer.title })).toBeInTheDocument();
    expect(mocks.collabServerProbe).toHaveBeenCalledWith("https://collab.uni.edu");
  });

  it("opens Manage server for an admin and comes back to the list", async () => {
    mocks.collabServersList.mockResolvedValue([server({ account: account({ server_role: "admin" }) })]);
    mocks.collabAdminMembers.mockResolvedValue([]);
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    const user = userEvent.setup();
    render(<CollaborationSection />);
    await user.click(await screen.findByRole("button", { name: copy.server.manage }));
    expect(await screen.findByTestId("collab-manage-server")).toBeInTheDocument();
    expect(screen.queryByTestId("collaboration-section")).toBeNull();
    await user.click(screen.getByRole("button", { name: enCollab.admin.back }));
    expect(await screen.findByTestId("collaboration-section")).toBeInTheDocument();
  });

  it("goes back to the server list when the managed server goes away", async () => {
    mocks.collabServersList.mockResolvedValue([server({ account: account({ server_role: "admin" }) })]);
    mocks.collabAdminMembers.mockResolvedValue([]);
    mocks.collabServerProbe.mockResolvedValue(capabilities());
    const user = userEvent.setup();
    render(<CollaborationSection />);
    await user.click(await screen.findByRole("button", { name: copy.server.manage }));
    expect(await screen.findByTestId("collab-manage-server")).toBeInTheDocument();
    act(() => useCollabStore.setState({ servers: [] }));
    expect(await screen.findByTestId("collaboration-section")).toBeInTheDocument();
    expect(screen.queryByTestId("collab-manage-server")).toBeNull();
    expect(screen.getByText(copy.servers.empty.title)).toBeInTheDocument();
  });

  it("checks each signed-in server's current role when it opens", async () => {
    mocks.collabServersList.mockResolvedValue([server({ account: account({ server_role: "member" }) })]);
    mocks.collabServerRefresh.mockResolvedValue(server({ account: account({ server_role: "maintainer" }) }));
    render(<CollaborationSection />);
    expect(await screen.findByRole("button", { name: copy.server.manage })).toBeInTheDocument();
    expect(mocks.collabServerRefresh).toHaveBeenCalledTimes(1);
  });

  it("offers no way to hide from collaborators, since edits from someone nobody can see are a surprise", async () => {
    mocks.collabServersList.mockResolvedValue([]);
    render(<CollaborationSection />);
    await screen.findByText(copy.servers.empty.title);
    expect(screen.queryByTestId("settings-row-collab-presence")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

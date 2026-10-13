// @vitest-environment jsdom

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { COLLAB_SERVER_CHANGED_EVENT } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { account, capabilities, collabError, server, signedOutServer } from "./tests/fixtures";

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
}));

const events = vi.hoisted(() => ({ useTauriEvent: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));
vi.mock("@/hooks/use-tauri-event", () => ({ useTauriEvent: events.useTauriEvent }));

import { CollaborationSection } from "./CollaborationSection";
import { useCollabStore } from "./store";

const copy = enCollab.section;

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {} });
  mocks.collabServerDevices.mockResolvedValue([]);
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
    expect(events.useTauriEvent).toHaveBeenCalledWith(COLLAB_SERVER_CHANGED_EVENT, expect.any(Function));
    const handler = events.useTauriEvent.mock.calls.at(-1)?.[1] as () => void;
    act(() => handler());
    expect(await screen.findByRole("heading", { name: "Smith Lab" })).toBeInTheDocument();
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

  it("lets this person choose what others see of them on this computer", async () => {
    mocks.collabServersList.mockResolvedValue([]);
    useSettingsStore.setState({ collabPresence: "cursor" });
    const presence = copy.presence;
    const user = userEvent.setup();
    render(<CollaborationSection />);
    const row = screen.getByTestId("settings-row-collab-presence");
    expect(within(row).getByText(presence.description)).toBeInTheDocument();
    const group = within(row).getByRole("radiogroup", { name: presence.label });
    const choice = (name: string) => within(group).getByRole("radio", { name });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(choice(presence.options.cursor)).toBeChecked();
    await user.click(choice(presence.options.hidden));
    expect(useSettingsStore.getState().collabPresence).toBe("hidden");
    expect(choice(presence.options.hidden)).toBeChecked();
    expect(choice(presence.options.cursor)).not.toBeChecked();
    await user.click(screen.getByText(presence.options.file));
    expect(useSettingsStore.getState().collabPresence).toBe("file");
    expect(choice(presence.options.file)).toBeChecked();
  });
});

// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabServer } from "@/lib/tauri";
import { SERVER_ID, account, collabError, deferred, fill, server, signedOutServer } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabServersList: vi.fn(),
  collabServerRefresh: vi.fn(),
  listen: vi.fn(),
  useWindowGeometry: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabServersList: mocks.collabServersList,
  collabServerRefresh: mocks.collabServerRefresh,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/preview-geometry", () => ({ useWindowGeometry: mocks.useWindowGeometry }));
vi.mock("./AdminConsole", () => ({
  AdminConsole: ({ server: entry, actor }: { server: { name: string }; actor: string }) => (
    <p>{`Console for ${entry.name} as ${actor}`}</p>
  ),
}));

import { AdminConsoleWindow } from "./AdminConsoleWindow";

const copy = enCollab.console.states;
const SEARCH = `?view=admin&server=${SERVER_ID}`;
const ADMIN = server({ account: account({ server_role: "admin" }) });

let changed: ((event: { payload: { serverId: string } }) => void) | null = null;

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  changed = null;
  document.title = "Oleafly";
  mocks.collabServersList.mockResolvedValue([ADMIN]);
  mocks.collabServerRefresh.mockResolvedValue(ADMIN);
  mocks.listen.mockImplementation(async (_event: string, handler: typeof changed) => {
    changed = handler;
    return () => {};
  });
});

describe("AdminConsoleWindow", () => {
  it("opens the console for an admin with a fresh role and names the window", async () => {
    render(<AdminConsoleWindow search={SEARCH} />);
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    expect(await screen.findByText("Console for Smith Lab as admin")).toBeInTheDocument();
    expect(mocks.collabServerRefresh).toHaveBeenCalledWith(SERVER_ID);
    expect(document.title).toBe("Oleafly Server Admin Console");
    expect(mocks.useWindowGeometry).toHaveBeenCalledWith(`oleafly.console.geometry.${SERVER_ID}`);
    expect(mocks.listen).toHaveBeenCalledWith("collab-server-changed", expect.any(Function));
  });

  it("uses the saved role when the server cannot be asked", async () => {
    mocks.collabServerRefresh.mockRejectedValue(collabError("unreachable"));
    render(<AdminConsoleWindow search={SEARCH} />);
    expect(await screen.findByText("Console for Smith Lab as admin")).toBeInTheDocument();
  });

  it("refuses someone who is not an admin or maintainer", async () => {
    const regular = server({ account: account({ server_role: "member" }) });
    mocks.collabServersList.mockResolvedValue([regular]);
    mocks.collabServerRefresh.mockResolvedValue(regular);
    render(<AdminConsoleWindow search={SEARCH} />);
    expect(await screen.findByText(copy.refusedTitle)).toBeInTheDocument();
    expect(screen.getByText(fill(copy.refusedDescription, { role: enCollab.roles.member }))).toBeInTheDocument();
  });

  it("closes the console when the role changes in another window", async () => {
    render(<AdminConsoleWindow search={SEARCH} />);
    await screen.findByText("Console for Smith Lab as admin");
    mocks.collabServersList.mockResolvedValue([server({ account: account({ server_role: "guest" }) })]);
    await waitFor(() => expect(changed).not.toBeNull());
    await act(async () => changed?.({ payload: { serverId: "another-server" } }));
    expect(screen.getByText("Console for Smith Lab as admin")).toBeInTheDocument();
    await act(async () => changed?.({ payload: { serverId: SERVER_ID } }));
    expect(await screen.findByText(copy.refusedTitle)).toBeInTheDocument();
    expect(mocks.collabServerRefresh).toHaveBeenCalledTimes(1);
  });

  it("explains when the server list cannot be read after a change", async () => {
    render(<AdminConsoleWindow search={SEARCH} />);
    await screen.findByText("Console for Smith Lab as admin");
    mocks.collabServersList.mockRejectedValue(collabError("internal"));
    await waitFor(() => expect(changed).not.toBeNull());
    await act(async () => changed?.({ payload: { serverId: SERVER_ID } }));
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
  });

  it("refuses a role this version does not know", async () => {
    const later = server({ account: account({ server_role: "auditor" as never }) });
    mocks.collabServersList.mockResolvedValue([later]);
    mocks.collabServerRefresh.mockResolvedValue(later);
    render(<AdminConsoleWindow search={SEARCH} />);
    expect(await screen.findByText(fill(copy.refusedDescription, { role: "auditor" }))).toBeInTheDocument();
  });

  it("says when this computer is signed out of the server", async () => {
    mocks.collabServersList.mockResolvedValue([signedOutServer()]);
    render(<AdminConsoleWindow search={SEARCH} />);
    expect(await screen.findByText(copy.signedOutTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.signedOutDescription)).toBeInTheDocument();
    expect(mocks.collabServerRefresh).not.toHaveBeenCalled();
  });

  it.each([
    ["a server that is no longer listed", SEARCH, []],
    ["a window opened without a server", "?view=admin", [ADMIN]],
  ])("says when it is given %s", async (_label, search, listed) => {
    mocks.collabServersList.mockResolvedValue(listed);
    render(<AdminConsoleWindow search={search} />);
    expect(await screen.findByText(copy.unknownTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.unknownDescription)).toBeInTheDocument();
  });

  it("explains a failed load and tries again", async () => {
    mocks.collabServersList.mockRejectedValueOnce(collabError("internal")).mockResolvedValueOnce([ADMIN]);
    render(<AdminConsoleWindow search={SEARCH} />);
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.internal)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText("Console for Smith Lab as admin")).toBeInTheDocument();
  });

  it("refuses a signed-in server that names no account", async () => {
    const nobody = server({ account: null });
    mocks.collabServersList.mockResolvedValue([nobody]);
    mocks.collabServerRefresh.mockResolvedValue(nobody);
    render(<AdminConsoleWindow search={SEARCH} />);
    expect(await screen.findByText(copy.refusedTitle)).toBeInTheDocument();
    expect(screen.queryByText(/Console for/)).toBeNull();
  });

  it("shows the server the window now points at when an older lookup comes back late", async () => {
    const slow = deferred<CollabServer[]>();
    const failing = deferred<CollabServer[]>();
    mocks.collabServersList
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce([ADMIN]);
    const { rerender } = render(<AdminConsoleWindow search="?view=admin&server=server-a" />);
    rerender(<AdminConsoleWindow search="?view=admin&server=server-b" />);
    rerender(<AdminConsoleWindow search={SEARCH} />);
    expect(await screen.findByText("Console for Smith Lab as admin")).toBeInTheDocument();
    await act(async () => {
      slow.resolve([]);
      failing.reject(collabError("internal"));
      await Promise.allSettled([slow.promise, failing.promise]);
    });
    expect(screen.getByText("Console for Smith Lab as admin")).toBeInTheDocument();
    expect(screen.queryByText(copy.unknownTitle)).toBeNull();
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
  });

  it("reads the server from the window address by default", async () => {
    window.history.replaceState(null, "", `/index.html${SEARCH}`);
    render(<AdminConsoleWindow />);
    expect(await screen.findByText("Console for Smith Lab as admin")).toBeInTheDocument();
  });
});

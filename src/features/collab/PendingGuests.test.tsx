// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabGuestInvitation } from "@/lib/tauri";
import type { ServerRole } from "./roles";
import { ALICE_ID, BOB_ID, SERVER_ID, collabError, deferred, fill, member } from "./tests/fixtures";
import { invitation } from "./tests/guest-fixtures";

const mocks = vi.hoisted(() => ({
  collabAdminGuestInvitations: vi.fn(),
  collabAdminGuestApprove: vi.fn(),
  collabAdminGuestDecline: vi.fn(),
  collabAdminGuestRevoke: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { MembersTab } from "./MembersTab";

const guests = enCollab.guests;
const DANA = invitation({ id: "dana", email: "dana@field.org", status: "awaiting_approval", role: "editor" });
const EVE = invitation({ id: "eve", email: "eve@field.org", status: "invited" });

function renderTab(actor: ServerRole = "admin", loadError: string | null = null) {
  const guest = member({
    account_id: BOB_ID,
    display_name: "Gus Guest",
    emails: ["gus@field.org"],
    logins: [],
    server_role: "guest",
  });
  return render(
    <MembersTab
      serverId={SERVER_ID}
      actor={actor}
      selfId={ALICE_ID}
      members={[member({ server_role: "admin" }), guest]}
      loadError={loadError}
      onRetry={() => undefined}
      onMembersChange={() => undefined}
    />,
  );
}

beforeAll(async () => {
  await loadNamespace("collab");
  await loadNamespace("common");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabAdminGuestInvitations.mockResolvedValue([DANA, EVE]);
  mocks.collabAdminGuestApprove.mockResolvedValue({ ...DANA, status: "invited" });
  mocks.collabAdminGuestDecline.mockResolvedValue({ ...DANA, status: "declined" });
  mocks.collabAdminGuestRevoke.mockResolvedValue(undefined);
});

describe("Pending guests in Manage server, People", () => {
  it("lists each invitation with who invited them, to which project and its state", async () => {
    renderTab();
    const list = await screen.findByRole("list", { name: guests.pending.title });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("dana@field.org")).toBeInTheDocument();
    expect(within(rows[0]).getByText(guests.badge)).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent(fill(guests.pending.invitedBy, { inviter: "Bob Smith", project: "Grant proposal" }));
    expect(within(rows[0]).getByText(guests.list.status.awaiting_approval)).toBeInTheDocument();
    expect(within(rows[0]).getByText(enCollab.projectRoles.editor)).toBeInTheDocument();
    expect(within(rows[1]).getByText(guests.list.status.invited)).toBeInTheDocument();
    expect(mocks.collabAdminGuestInvitations).toHaveBeenCalledWith(SERVER_ID);
  });

  it("approves and declines invitations that wait for approval", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: fill(guests.pending.approveNamed, { email: "dana@field.org" }) }));
    expect(mocks.collabAdminGuestApprove).toHaveBeenCalledWith(SERVER_ID, "dana");
    const list = screen.getByRole("list", { name: guests.pending.title });
    await waitFor(() =>
      expect(within(within(list).getAllByRole("listitem")[0]).getByText(guests.list.status.invited)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: fill(guests.pending.declineNamed, { email: "dana@field.org" }) })).toBeNull();
  });

  it("keeps an invitation busy until its own answer ends, whatever another one does", async () => {
    const OTHER = invitation({ id: "finn", email: "finn@field.org", status: "awaiting_approval" });
    const forDana = deferred<CollabGuestInvitation>();
    const forFinn = deferred<CollabGuestInvitation>();
    mocks.collabAdminGuestInvitations.mockResolvedValue([DANA, OTHER]);
    mocks.collabAdminGuestApprove.mockImplementation((_server: string, id: string) =>
      id === "dana" ? forDana.promise : forFinn.promise,
    );
    const user = userEvent.setup();
    renderTab();
    const approve = (email: string) =>
      screen.getByRole("button", { name: fill(guests.pending.approveNamed, { email }) });
    await screen.findByText("finn@field.org");
    await user.click(approve("dana@field.org"));
    await user.click(approve("finn@field.org"));
    await act(async () => forDana.resolve({ ...DANA, status: "invited" }));
    expect(approve("finn@field.org")).toBeDisabled();
    expect(mocks.collabAdminGuestApprove).toHaveBeenCalledTimes(2);
    await act(async () => forFinn.resolve({ ...OTHER, status: "invited" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: fill(guests.pending.approveNamed, { email: "finn@field.org" }) })).toBeNull());
  });

  it("removes a declined invitation from the list", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: fill(guests.pending.declineNamed, { email: "dana@field.org" }) }));
    expect(mocks.collabAdminGuestDecline).toHaveBeenCalledWith(SERVER_ID, "dana");
    await waitFor(() => expect(screen.queryByText("dana@field.org")).toBeNull());
  });

  it("withdraws an invitation that was already approved", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: fill(guests.list.withdrawNamed, { email: "eve@field.org" }) }));
    expect(mocks.collabAdminGuestRevoke).toHaveBeenCalledWith(SERVER_ID, "eve");
    await waitFor(() => expect(screen.queryByText("eve@field.org")).toBeNull());
  });

  it("explains a failed action next to the invitation", async () => {
    mocks.collabAdminGuestApprove.mockRejectedValue(collabError("conflict"));
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: fill(guests.pending.approveNamed, { email: "dana@field.org" }) }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.conflict);
  });

  it("stays out of the way when nobody is waiting", async () => {
    mocks.collabAdminGuestInvitations.mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(mocks.collabAdminGuestInvitations).toHaveBeenCalled());
    expect(screen.queryByText(guests.pending.title)).toBeNull();
  });

  it("explains invitations that can't be loaded and loads them again on Retry", async () => {
    mocks.collabAdminGuestInvitations.mockRejectedValueOnce(collabError("unreachable"));
    const user = userEvent.setup();
    renderTab();
    expect(await screen.findByText(guests.pending.loadFailed)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: guests.pending.title })).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unreachable)).toBeInTheDocument();
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText("dana@field.org")).toBeInTheDocument();
    expect(screen.queryByText(guests.pending.loadFailed)).toBeNull();
  });

  it("adds no second error when the member list itself failed", async () => {
    renderTab("admin", enCollab.errors.unreachable);
    await act(async () => {});
    expect(mocks.collabAdminGuestInvitations).not.toHaveBeenCalled();
    expect(screen.queryByText(guests.pending.title)).toBeNull();
    expect(screen.getAllByRole("button", { name: enCommon.actions.retry })).toHaveLength(1);
  });

  it("does not look for invitations when the person cannot approve guests", async () => {
    renderTab("member");
    expect(screen.getByText("Gus Guest")).toBeInTheDocument();
    await act(async () => {});
    expect(mocks.collabAdminGuestInvitations).not.toHaveBeenCalled();
    expect(screen.queryByText(guests.pending.title)).toBeNull();
  });

  it("lists the invitations of the server now in view when an older answer comes back late", async () => {
    const slow = deferred<CollabGuestInvitation[]>();
    const failing = deferred<CollabGuestInvitation[]>();
    mocks.collabAdminGuestInvitations
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce([EVE]);
    const props = {
      actor: "admin" as const,
      selfId: ALICE_ID,
      members: [member({ server_role: "admin" })],
      loadError: null,
      onRetry: () => undefined,
      onMembersChange: () => undefined,
    };
    const { rerender } = render(<MembersTab serverId="server-a" {...props} />);
    rerender(<MembersTab serverId="server-b" {...props} />);
    rerender(<MembersTab serverId={SERVER_ID} {...props} />);
    const list = await screen.findByRole("list", { name: guests.pending.title });
    await act(async () => {
      slow.resolve([DANA, EVE]);
      failing.reject(collabError("unreachable"));
      await Promise.allSettled([slow.promise, failing.promise]);
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("dana@field.org")).toBeNull();
    expect(screen.getByText("eve@field.org")).toBeInTheDocument();
  });

  it("marks guest accounts in the member list", async () => {
    renderTab();
    const nameLine = within(screen.getByTestId(`collab-member-${BOB_ID}`)).getByText("Gus Guest").parentElement;
    expect(nameLine && within(nameLine).getByText(guests.badge)).toBeInTheDocument();
    const adminLine = within(screen.getByTestId(`collab-member-${ALICE_ID}`)).getByText("Alice Chen").parentElement;
    expect(adminLine && within(adminLine).queryByText(guests.badge)).toBeNull();
    await screen.findByRole("list", { name: guests.pending.title });
  });
});

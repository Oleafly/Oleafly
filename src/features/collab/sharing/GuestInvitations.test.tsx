// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatDate } from "@/lib/intl";
import { BOB, CAROL, collabError, fill, projectMember, projectSummary, shareInfo } from "../tests/fixtures";
import { ADD_LINK, invitation, inviteResult, projectInvitations } from "../tests/guest-fixtures";

const mocks = vi.hoisted(() => ({
  collabProjectSummary: vi.fn(),
  collabMembersList: vi.fn(),
  collabPeopleSearch: vi.fn(),
  collabGuestInvitations: vi.fn(),
  collabGuestInvite: vi.fn(),
  collabGuestInvitationRevoke: vi.fn(),
  collabCommentsStatus: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabProjectSummary: mocks.collabProjectSummary,
  collabMembersList: mocks.collabMembersList,
  collabPeopleSearch: mocks.collabPeopleSearch,
  collabGuestInvitations: mocks.collabGuestInvitations,
  collabGuestInvite: mocks.collabGuestInvite,
  collabGuestInvitationRevoke: mocks.collabGuestInvitationRevoke,
  collabCommentsStatus: mocks.collabCommentsStatus,
}));

import { ManageSharing } from "./ManageSharing";

const guests = enCollab.guests;
const EMAIL = "dana@field.org";

function renderManage(role: "owner" | "editor" = "owner") {
  return render(<ManageSharing projectId="grant" name="Grant proposal" share={shareInfo({ role })} />);
}

async function typeQuery(text: string) {
  const user = userEvent.setup();
  renderManage();
  await user.type(await screen.findByLabelText(enCollab.manage.add.label), text);
  return user;
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabProjectSummary.mockResolvedValue(projectSummary());
  mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner")]);
  mocks.collabPeopleSearch.mockResolvedValue([]);
  mocks.collabGuestInvitations.mockResolvedValue(projectInvitations());
  mocks.collabGuestInvite.mockResolvedValue(inviteResult());
  mocks.collabGuestInvitationRevoke.mockResolvedValue(undefined);
  mocks.collabCommentsStatus.mockResolvedValue({ serverAllowed: true, projectEnabled: true, canComment: true });
});

describe("inviting a guest from the share dialog", () => {
  it("offers an owner to invite an address nobody on the server uses", async () => {
    const user = await typeQuery(EMAIL);
    expect(
      await screen.findByText(fill(guests.invite.noAccount, { server: "Smith Lab", email: EMAIL })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: fill(guests.invite.buttonNamed, { email: EMAIL }) }));
    expect(mocks.collabGuestInvite).toHaveBeenCalledWith("grant", EMAIL, "editor");
    expect(await screen.findByText(fill(guests.sent.emailed, { email: EMAIL }))).toBeInTheDocument();
  });

  it("does not offer it while guests are off on the server", async () => {
    mocks.collabGuestInvitations.mockResolvedValue(projectInvitations({ guests_enabled: false }));
    await typeQuery(EMAIL);
    expect(await screen.findByText(fill(enCollab.manage.add.noResults, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: fill(guests.invite.buttonNamed, { email: EMAIL }) })).toBeNull();
  });

  it("does not offer it for a name or for an address someone already uses", async () => {
    await typeQuery("dana");
    expect(await screen.findByText(fill(enCollab.manage.add.noResults, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: guests.invite.button })).toBeNull();
    mocks.collabPeopleSearch.mockResolvedValue([CAROL]);
    const user = userEvent.setup();
    const input = screen.getByLabelText(enCollab.manage.add.label);
    await user.clear(input);
    await user.type(input, "carol@uni.edu");
    expect(await screen.findByRole("button", { name: fill(enCollab.manage.add.addNamed, { name: "Carol Diaz" }) }))
      .toBeInTheDocument();
    expect(screen.queryByText(guests.invite.button)).toBeNull();
  });

  it("is never offered to someone who is not the owner", async () => {
    renderManage("editor");
    expect(await screen.findByRole("list", { name: enCollab.manage.people })).toBeInTheDocument();
    expect(screen.queryByLabelText(enCollab.manage.add.label)).toBeNull();
    expect(mocks.collabGuestInvitations).not.toHaveBeenCalled();
  });

  it("says an admin must approve first when the server asks for approval", async () => {
    mocks.collabGuestInvite.mockResolvedValue(
      inviteResult({ invitation: invitation({ status: "awaiting_approval" }), emailed: true }),
    );
    const user = await typeQuery(EMAIL);
    await user.click(await screen.findByRole("button", { name: fill(guests.invite.buttonNamed, { email: EMAIL }) }));
    expect(await screen.findByText(fill(guests.sent.emailedAfterApproval, { email: EMAIL }))).toBeInTheDocument();
  });

  it("gives the owner the link to send when the server does not send email", async () => {
    mocks.collabGuestInvite.mockResolvedValue(inviteResult({ emailed: false }));
    const user = await typeQuery(EMAIL);
    await user.click(await screen.findByRole("button", { name: fill(guests.invite.buttonNamed, { email: EMAIL }) }));
    expect(
      await screen.findByText(fill(guests.sent.sendLink, { server: "Smith Lab", email: EMAIL })),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(fill(guests.sent.linkLabel, { server: "Smith Lab" }))).toHaveValue(ADD_LINK);
    expect(screen.getAllByRole("button", { name: enCollab.manage.link.copy }).length).toBeGreaterThan(0);
  });

  it("says when an address already had an account and reloads who has access", async () => {
    mocks.collabGuestInvite.mockResolvedValue(inviteResult({ invitation: invitation({ status: "accepted" }) }));
    const user = await typeQuery(EMAIL);
    expect(mocks.collabMembersList).toHaveBeenCalledTimes(1);
    await user.click(await screen.findByRole("button", { name: fill(guests.invite.buttonNamed, { email: EMAIL }) }));
    expect(
      await screen.findByText(fill(guests.sent.added, { server: "Smith Lab", email: EMAIL })),
    ).toBeInTheDocument();
    await waitFor(() => expect(mocks.collabMembersList).toHaveBeenCalledTimes(2));
  });

  it("explains a duplicate invitation and the hourly limit in plain words", async () => {
    mocks.collabGuestInvite.mockRejectedValueOnce(collabError("conflict"));
    mocks.collabGuestInvite.mockRejectedValueOnce(collabError("rate_limited"));
    const user = await typeQuery(EMAIL);
    const button = await screen.findByRole("button", { name: fill(guests.invite.buttonNamed, { email: EMAIL }) });
    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(guests.invite.duplicate);
    await user.click(button);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(guests.invite.tooMany));
  });
});

describe("the owner's invitation list", () => {
  it("shows each open invitation with its status, role, end date and guest badge", async () => {
    mocks.collabGuestInvitations.mockResolvedValue(
      projectInvitations({
        approval_required: true,
        invitations: [
          invitation({ id: "a", email: "dana@field.org", status: "awaiting_approval" }),
          invitation({ id: "b", email: "eve@field.org", status: "invited", role: "editor" }),
          invitation({ id: "c", email: "finn@field.org", status: "declined" }),
        ],
      }),
    );
    renderManage();
    const list = await screen.findByRole("list", { name: guests.list.title });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("dana@field.org")).toBeInTheDocument();
    expect(within(rows[0]).getByText(guests.list.status.awaiting_approval)).toBeInTheDocument();
    expect(within(rows[0]).getByText(guests.badge)).toBeInTheDocument();
    expect(within(rows[1]).getByText(guests.list.status.invited)).toBeInTheDocument();
    expect(within(rows[1]).getByText(enCollab.projectRoles.editor)).toBeInTheDocument();
    expect(within(rows[2]).getByText(guests.list.status.declined)).toBeInTheDocument();
    expect(
      within(rows[0]).getByText(fill(guests.list.expires, { date: formatDate(1_761_209_600_000) })),
    ).toBeInTheDocument();
    expect(within(rows[2]).queryByRole("button", { name: /withdraw/i })).toBeNull();
  });

  it("withdraws an invitation", async () => {
    mocks.collabGuestInvitations.mockResolvedValue(projectInvitations({ invitations: [invitation()] }));
    const user = userEvent.setup();
    renderManage();
    await user.click(await screen.findByRole("button", { name: fill(guests.list.withdrawNamed, { email: EMAIL }) }));
    expect(mocks.collabGuestInvitationRevoke).toHaveBeenCalledWith("grant", "invitation-1");
    await waitFor(() => expect(screen.queryByRole("list", { name: guests.list.title })).toBeNull());
  });

  it("offers the link again for open invitations when the server does not send email", async () => {
    mocks.collabGuestInvitations.mockResolvedValue(
      projectInvitations({ sends_email: false, invitations: [invitation()] }),
    );
    renderManage();
    const list = await screen.findByRole("list", { name: guests.list.title });
    expect(within(list).getByRole("button", { name: enCollab.manage.link.copy })).toBeInTheDocument();
  });

  it("marks guests among the people with access", async () => {
    mocks.collabMembersList.mockResolvedValue([
      projectMember(BOB, "owner"),
      projectMember({ ...CAROL, guest: true }, "viewer"),
    ]);
    renderManage();
    const people = await screen.findByRole("list", { name: enCollab.manage.people });
    const rows = within(people).getAllByRole("listitem");
    expect(within(rows[0]).queryByText(guests.badge)).toBeNull();
    expect(within(rows[1]).getByText(guests.badge)).toBeInTheDocument();
  });
});

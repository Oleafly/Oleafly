// @vitest-environment jsdom

import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabMember } from "@/lib/tauri";
import type { ServerRole } from "./roles";
import { ALICE_ID, BOB_ID, CAROL_ID, SERVER_ID, collabError, deferred, device, fill, member } from "./tests/fixtures";
import { allowRadixSelect, chooseOption } from "./tests/select";

const mocks = vi.hoisted(() => ({
  collabAdminPatchMember: vi.fn(),
  collabAdminRemoveMember: vi.fn(),
  collabAdminMemberDevices: vi.fn(),
  collabAdminSignOutDevice: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { MembersTab } from "./MembersTab";

const copy = enCollab.admin.members;
const roles = enCollab.roles;
const alice = member({ server_role: "admin" });
const bob = member({ account_id: BOB_ID, display_name: "Bob Smith", emails: ["bob@uni.edu"], logins: [] });
const carol = member({
  account_id: CAROL_ID,
  display_name: "Carol Diaz",
  emails: ["carol@uni.edu"],
  logins: [],
  server_role: "maintainer",
});

function Harness({
  actor,
  initial,
  selfId = ALICE_ID,
}: Readonly<{ actor: ServerRole; initial: CollabMember[]; selfId?: string }>) {
  const [members, setMembers] = useState(initial);
  return (
    <MembersTab
      serverId={SERVER_ID}
      actor={actor}
      selfId={selfId}
      members={members}
      loadError={null}
      onRetry={() => undefined}
      onMembersChange={(update) => setMembers((current) => update(current))}
    />
  );
}

function rowOf(accountId: string): HTMLElement {
  return screen.getByTestId(`collab-member-${accountId}`);
}

beforeAll(async () => {
  await loadNamespace("collab");
  allowRadixSelect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MembersTab", () => {
  it("lists members with their picture, contact, status and role", () => {
    render(<Harness actor="admin" initial={[alice, bob]} />);
    expect(screen.getByText(copy.description)).toBeInTheDocument();
    expect(rowOf(ALICE_ID)).toHaveTextContent("Alice Chen");
    expect(rowOf(ALICE_ID)).toHaveTextContent(copy.you);
    expect(rowOf(BOB_ID)).toHaveTextContent("bob@uni.edu");
    expect(rowOf(BOB_ID)).toHaveTextContent(copy.active);
    expect(rowOf(BOB_ID).querySelector('[data-slot="avatar"]')).not.toBeNull();
  });

  it("takes you to the allowed list when you want to add someone", async () => {
    const onAddPeople = vi.fn();
    render(
      <MembersTab
        serverId={SERVER_ID}
        actor="admin"
        selfId={ALICE_ID}
        members={[alice]}
        loadError={null}
        onRetry={() => undefined}
        onMembersChange={() => undefined}
        onAddPeople={onAddPeople}
      />,
    );
    expect(screen.getByText(copy.addHint)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: copy.addPeople }));
    expect(onAddPeople).toHaveBeenCalledOnce();
  });

  it("offers no add button where it cannot lead anywhere", () => {
    render(<Harness actor="admin" initial={[alice]} />);
    expect(screen.queryByRole("button", { name: copy.addPeople })).toBeNull();
    expect(screen.queryByText(copy.addHint)).toBeNull();
  });

  it("changes a member's role", async () => {
    mocks.collabAdminPatchMember.mockResolvedValue(member({ ...bob.account, server_role: "maintainer" }));
    const user = userEvent.setup();
    render(<Harness actor="admin" initial={[alice, bob]} />);
    await chooseOption(user, fill(copy.roleLabel, { name: "Bob Smith" }), roles.maintainer);
    expect(mocks.collabAdminPatchMember).toHaveBeenCalledWith(SERVER_ID, BOB_ID, { role: "maintainer" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: fill(copy.roleLabel, { name: "Bob Smith" }) })).toHaveTextContent(
        roles.maintainer,
      ),
    );
  });

  it("suspends and reactivates a member", async () => {
    mocks.collabAdminPatchMember
      .mockResolvedValueOnce(member(bob.account, "suspended"))
      .mockResolvedValueOnce(member(bob.account, "active"));
    const user = userEvent.setup();
    render(<Harness actor="maintainer" initial={[bob]} selfId={CAROL_ID} />);
    await user.click(within(rowOf(BOB_ID)).getByRole("button", { name: copy.suspend }));
    expect(mocks.collabAdminPatchMember).toHaveBeenLastCalledWith(SERVER_ID, BOB_ID, { status: "suspended" });
    expect(await within(rowOf(BOB_ID)).findByText(copy.suspended)).toBeInTheDocument();
    await user.click(within(rowOf(BOB_ID)).getByRole("button", { name: copy.reactivate }));
    expect(mocks.collabAdminPatchMember).toHaveBeenLastCalledWith(SERVER_ID, BOB_ID, { status: "active" });
    expect(await within(rowOf(BOB_ID)).findByText(copy.active)).toBeInTheDocument();
  });

  it("keeps a row busy until its own action ends, whatever another row does", async () => {
    const DAVE_ID = "0192a0b0-0000-7000-8000-0000000000d4";
    const dave = member({ account_id: DAVE_ID, display_name: "Dave Ng", emails: ["dave@uni.edu"], logins: [] });
    const forBob = deferred<CollabMember>();
    const forDave = deferred<CollabMember>();
    mocks.collabAdminPatchMember.mockImplementation((_server: string, accountId: string) =>
      accountId === BOB_ID ? forBob.promise : forDave.promise,
    );
    const user = userEvent.setup();
    render(<Harness actor="admin" initial={[alice, bob, dave]} />);
    await user.click(within(rowOf(BOB_ID)).getByRole("button", { name: copy.suspend }));
    await user.click(within(rowOf(DAVE_ID)).getByRole("button", { name: copy.suspend }));
    expect(within(rowOf(BOB_ID)).getByRole("button", { name: copy.suspend })).toBeDisabled();
    await act(async () => {
      forBob.resolve(member(bob.account, "suspended"));
      await forBob.promise;
    });
    expect(within(rowOf(BOB_ID)).getByRole("button", { name: copy.reactivate })).toBeEnabled();
    expect(within(rowOf(DAVE_ID)).getByRole("button", { name: copy.suspend })).toBeDisabled();
    expect(within(rowOf(DAVE_ID)).getByRole("button", { name: copy.remove })).toBeDisabled();
    await act(async () => {
      forDave.resolve(member(dave.account, "suspended"));
      await forDave.promise;
    });
    expect(within(rowOf(DAVE_ID)).getByRole("button", { name: copy.reactivate })).toBeEnabled();
    expect(mocks.collabAdminPatchMember).toHaveBeenCalledTimes(2);
  });

  it("keeps staff rows read-only for a maintainer", () => {
    render(<Harness actor="maintainer" initial={[alice, carol, bob]} selfId={CAROL_ID} />);
    expect(within(rowOf(ALICE_ID)).queryByRole("combobox")).toBeNull();
    expect(within(rowOf(ALICE_ID)).getByText(roles.admin)).toBeInTheDocument();
    expect(within(rowOf(ALICE_ID)).queryByRole("button", { name: copy.remove })).toBeNull();
    expect(within(rowOf(CAROL_ID)).queryByRole("combobox")).toBeNull();
    expect(within(rowOf(BOB_ID)).getByRole("combobox")).toBeInTheDocument();
  });

  it("offers a maintainer the devices of members and their own but not of other staff", () => {
    render(<Harness actor="maintainer" initial={[alice, carol, bob]} selfId={CAROL_ID} />);
    expect(within(rowOf(ALICE_ID)).queryByRole("button", { name: copy.devices })).toBeNull();
    expect(within(rowOf(CAROL_ID)).getByRole("button", { name: copy.devices })).toBeInTheDocument();
    expect(within(rowOf(BOB_ID)).getByRole("button", { name: copy.devices })).toBeInTheDocument();
  });

  it("explains that the last admin cannot step down", async () => {
    mocks.collabAdminPatchMember.mockRejectedValue(collabError("conflict"));
    const user = userEvent.setup();
    render(<Harness actor="admin" initial={[alice, bob]} />);
    await chooseOption(user, fill(copy.roleLabel, { name: "Alice Chen" }), roles.member);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: copy.selfRoleConfirm.confirm }),
    );
    expect(await within(rowOf(ALICE_ID)).findByRole("alert")).toHaveTextContent(copy.lastAdmin);
    expect(screen.getByRole("combobox", { name: fill(copy.roleLabel, { name: "Alice Chen" }) })).toHaveTextContent(
      roles.admin,
    );
  });

  it("asks before you change your own role, and keeps it when you cancel", async () => {
    mocks.collabAdminPatchMember.mockResolvedValue(member({ ...alice.account, server_role: "maintainer" }));
    const user = userEvent.setup();
    render(<Harness actor="admin" initial={[alice, bob]} />);
    await chooseOption(user, fill(copy.roleLabel, { name: "Alice Chen" }), roles.maintainer);
    const dialog = await screen.findByRole("alertdialog", {
      name: fill(copy.selfRoleConfirm.title, { role: roles.maintainer }),
    });
    expect(dialog).toHaveTextContent(copy.selfRoleConfirm.description);
    expect(mocks.collabAdminPatchMember).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`) }));
    expect(mocks.collabAdminPatchMember).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: fill(copy.roleLabel, { name: "Alice Chen" }) })).toHaveTextContent(
      roles.admin,
    );
    await chooseOption(user, fill(copy.roleLabel, { name: "Alice Chen" }), roles.maintainer);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: copy.selfRoleConfirm.confirm }),
    );
    expect(mocks.collabAdminPatchMember).toHaveBeenCalledWith(SERVER_ID, ALICE_ID, { role: "maintainer" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: fill(copy.roleLabel, { name: "Alice Chen" }) })).toHaveTextContent(
        roles.maintainer,
      ),
    );
  });

  it("changes someone else's role without asking", async () => {
    mocks.collabAdminPatchMember.mockResolvedValue(member({ ...bob.account, server_role: "maintainer" }));
    const user = userEvent.setup();
    render(<Harness actor="admin" initial={[alice, bob]} />);
    await chooseOption(user, fill(copy.roleLabel, { name: "Bob Smith" }), roles.maintainer);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.collabAdminPatchMember).toHaveBeenCalledWith(SERVER_ID, BOB_ID, { role: "maintainer" });
  });

  it("never offers to suspend or remove yourself", () => {
    render(<Harness actor="admin" initial={[alice]} />);
    expect(within(rowOf(ALICE_ID)).queryByRole("button", { name: copy.suspend })).toBeNull();
    expect(within(rowOf(ALICE_ID)).queryByRole("button", { name: copy.remove })).toBeNull();
  });

  it("asks before removing a member and drops the row", async () => {
    mocks.collabAdminRemoveMember.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Harness actor="admin" initial={[alice, bob]} />);
    await user.click(within(rowOf(BOB_ID)).getByRole("button", { name: copy.remove }));
    const dialog = screen.getByRole("alertdialog", { name: fill(copy.removeConfirm.title, { name: "Bob Smith" }) });
    expect(dialog).toHaveTextContent(copy.removeConfirm.description);
    await user.click(within(dialog).getByRole("button", { name: copy.removeConfirm.confirm }));
    expect(mocks.collabAdminRemoveMember).toHaveBeenCalledWith(SERVER_ID, BOB_ID);
    await waitFor(() => expect(screen.queryByTestId(`collab-member-${BOB_ID}`)).toBeNull());
  });

  it("shows a member's devices and signs one out", async () => {
    mocks.collabAdminMemberDevices.mockResolvedValue([device({ device_id: "d-7", name: "Bob's laptop" })]);
    mocks.collabAdminSignOutDevice.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Harness actor="maintainer" initial={[bob]} selfId={CAROL_ID} />);
    const toggle = within(rowOf(BOB_ID)).getByRole("button", { name: copy.devices });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(rowOf(BOB_ID)).getByRole("heading", { name: fill(copy.devicesTitle, { name: "Bob Smith" }) }),
    ).toBeInTheDocument();
    expect(mocks.collabAdminMemberDevices).toHaveBeenCalledWith(SERVER_ID, BOB_ID);
    await user.click(
      await screen.findByRole("button", { name: fill(enCollab.section.devices.signOutNamed, { name: "Bob's laptop" }) }),
    );
    await user.click(screen.getByRole("button", { name: copy.deviceSignOutConfirm.confirm }));
    expect(mocks.collabAdminSignOutDevice).toHaveBeenCalledWith(SERVER_ID, "d-7");
    expect(await within(rowOf(BOB_ID)).findByText(enCollab.section.devices.empty)).toBeInTheDocument();
  });

  it("hides a member's devices again on a second click", async () => {
    mocks.collabAdminMemberDevices.mockResolvedValue([device({ device_id: "d-7", name: "Bob's laptop" })]);
    const user = userEvent.setup();
    render(<Harness actor="admin" initial={[alice, bob]} />);
    const toggle = within(rowOf(BOB_ID)).getByRole("button", { name: copy.devices });
    await user.click(toggle);
    expect(await within(rowOf(BOB_ID)).findByTestId("collab-device-d-7")).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(rowOf(BOB_ID)).queryByTestId("collab-device-d-7")).toBeNull();
    expect(
      within(rowOf(BOB_ID)).queryByRole("heading", { name: fill(copy.devicesTitle, { name: "Bob Smith" }) }),
    ).toBeNull();
  });

  it("shows a role from a later server as an unknown role, without a picker", () => {
    const later = member({ ...bob.account, server_role: "unknown" });
    render(<Harness actor="admin" initial={[alice, later]} />);
    expect(within(rowOf(BOB_ID)).getByText(enCollab.roles.unknown)).toBeInTheDocument();
    expect(within(rowOf(BOB_ID)).queryByRole("combobox")).toBeNull();
    expect(within(rowOf(BOB_ID)).queryByRole("button", { name: copy.suspend })).toBeNull();
  });

  it("shows a removed account without any actions", () => {
    render(<Harness actor="admin" initial={[member(bob.account, "removed")]} />);
    expect(rowOf(BOB_ID)).toHaveTextContent(copy.removed);
    expect(within(rowOf(BOB_ID)).queryByRole("button")).toBeNull();
    expect(within(rowOf(BOB_ID)).queryByRole("combobox")).toBeNull();
  });

  it("shows the loading, empty and failed states", async () => {
    const onRetry = vi.fn();
    const props = {
      serverId: SERVER_ID,
      actor: "admin" as const,
      selfId: ALICE_ID,
      onRetry,
      onMembersChange: () => undefined,
    };
    const { rerender } = render(<MembersTab {...props} members={null} loadError={null} />);
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    rerender(<MembersTab {...props} members={[]} loadError={null} />);
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    rerender(<MembersTab {...props} members={null} loadError={enCollab.errors.forbidden} />);
    expect(screen.getByText(enCollab.admin.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.forbidden)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(onRetry).toHaveBeenCalled();
  });
});

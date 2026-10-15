// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabCommentsStatus, CollabPerson, CollabProjectSummary } from "@/lib/tauri";
import { useShareDialog } from "@/components/collab/share-dialog";
import {
  BOB,
  CAROL,
  collabError,
  deferred,
  fill,
  person,
  projectMember,
  projectSummary,
  shareInfo,
} from "../tests/fixtures";
import { allowRadixSelect, chooseOption } from "../tests/select";
import { useAccessLogSwitches } from "./access-log-store";

const mocks = vi.hoisted(() => ({
  collabProjectSummary: vi.fn(),
  collabMembersList: vi.fn(),
  collabCommentsStatus: vi.fn(),
  collabAccessLogStatus: vi.fn(),
  collabAccessLogSetEnabled: vi.fn(),
  collabPeopleSearch: vi.fn(),
  collabMemberSet: vi.fn(),
  collabLinkSharingSet: vi.fn(),
  collabStopSharing: vi.fn(),
  collabGuestInvitations: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabProjectSummary: mocks.collabProjectSummary,
  collabMembersList: mocks.collabMembersList,
  collabCommentsStatus: mocks.collabCommentsStatus,
  collabAccessLogStatus: mocks.collabAccessLogStatus,
  collabAccessLogSetEnabled: mocks.collabAccessLogSetEnabled,
  collabPeopleSearch: mocks.collabPeopleSearch,
  collabMemberSet: mocks.collabMemberSet,
  collabLinkSharingSet: mocks.collabLinkSharingSet,
  collabStopSharing: mocks.collabStopSharing,
  collabGuestInvitations: mocks.collabGuestInvitations,
}));

import { ManageSharing } from "./ManageSharing";

const manage = enCollab.manage;
const roles = enCollab.projectRoles;
const alice = projectMember(person(), "editor");

function renderManage(projectId = "grant") {
  return render(<ManageSharing projectId={projectId} name="Grant proposal" share={shareInfo()} />);
}

async function search(text: string) {
  const user = userEvent.setup();
  renderManage();
  await user.type(await screen.findByRole("textbox", { name: manage.add.label }), text);
  return user;
}

beforeAll(async () => {
  await loadNamespace("collab");
  allowRadixSelect();
});

beforeEach(() => {
  vi.clearAllMocks();
  useAccessLogSwitches.setState({ byProject: {} });
  useShareDialog.setState({ projectId: "grant", fromCopy: false });
  mocks.collabProjectSummary.mockResolvedValue(projectSummary());
  mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner"), alice]);
  mocks.collabCommentsStatus.mockResolvedValue({ serverAllowed: true, projectEnabled: true, canComment: true });
  mocks.collabAccessLogStatus.mockResolvedValue({ serverAllowed: false, enabled: false });
  mocks.collabGuestInvitations.mockRejectedValue(collabError("forbidden"));
  mocks.collabPeopleSearch.mockResolvedValue([]);
});

afterEach(() => {
  useShareDialog.setState({ projectId: null, fromCopy: false });
});

describe("ManageSharing people list", () => {
  it("marks someone removed from the server or suspended on it", async () => {
    mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner"), alice, projectMember({ ...CAROL, active: false })]);
    renderManage();
    const carol = (await screen.findByText("Carol Diaz")).closest("li") as HTMLElement;
    expect(carol).toHaveTextContent(manage.inactive);
    expect(screen.getAllByText(manage.inactive)).toHaveLength(1);
  });
});

describe("ManageSharing people search", () => {
  it("explains a directory search that fails", async () => {
    mocks.collabPeopleSearch.mockRejectedValue(collabError("unreachable"));
    await search("car");
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(screen.queryByText(fill(manage.add.noResultsTryEmail, { server: "Smith Lab" }))).toBeNull();
  });

  it("shows only the answer for what is typed now when an earlier search answers late", async () => {
    const early = deferred<CollabPerson[]>();
    const late = deferred<CollabPerson[]>();
    mocks.collabPeopleSearch.mockImplementation((_project: string, query: string) =>
      query === "al" ? early.promise : late.promise,
    );
    const user = await search("al");
    await waitFor(() => expect(mocks.collabPeopleSearch).toHaveBeenCalledWith("grant", "al"));
    await user.type(screen.getByRole("textbox", { name: manage.add.label }), "x");
    await waitFor(() => expect(mocks.collabPeopleSearch).toHaveBeenCalledWith("grant", "alx"));
    await act(async () => late.resolve([CAROL]));
    expect(await screen.findByRole("button", { name: fill(manage.add.addNamed, { name: "Carol Diaz" }) }))
      .toBeInTheDocument();
    await act(async () => early.resolve([person({ account_id: "acc-dan", display_name: "Dan Ito" })]));
    expect(screen.queryByRole("button", { name: fill(manage.add.addNamed, { name: "Dan Ito" }) })).toBeNull();
    expect(screen.getByRole("button", { name: fill(manage.add.addNamed, { name: "Carol Diaz" }) })).toBeInTheDocument();
  });

  it("ignores a failure from a search the person already typed past", async () => {
    const early = deferred<CollabPerson[]>();
    mocks.collabPeopleSearch.mockImplementation((_project: string, query: string) =>
      query === "zo" ? early.promise : Promise.resolve([]),
    );
    const user = await search("zo");
    await waitFor(() => expect(mocks.collabPeopleSearch).toHaveBeenCalledWith("grant", "zo"));
    await user.type(screen.getByRole("textbox", { name: manage.add.label }), "e");
    expect(await screen.findByText(fill(manage.add.noResultsTryEmail, { server: "Smith Lab" }))).toBeInTheDocument();
    await act(async () => early.reject(collabError("unreachable")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(fill(manage.add.noResultsTryEmail, { server: "Smith Lab" }))).toBeInTheDocument();
  });

  it("says a match is already in the project instead of saying nobody matches", async () => {
    mocks.collabPeopleSearch.mockResolvedValue([alice.person]);
    await search("alice");
    expect(await screen.findByText(fill(manage.add.alreadyMember, { name: alice.person.display_name })))
      .toBeInTheDocument();
    expect(screen.queryByText(fill(manage.add.noResultsTryEmail, { server: "Smith Lab" }))).toBeNull();
  });

  it("says everyone who matches already has access", async () => {
    mocks.collabPeopleSearch.mockResolvedValue([alice.person, BOB]);
    await search("lab");
    expect(await screen.findByText(manage.add.allMembers)).toBeInTheDocument();
  });

  it("keeps the search and says why when adding someone fails", async () => {
    mocks.collabPeopleSearch.mockResolvedValue([CAROL]);
    mocks.collabMemberSet.mockRejectedValue(collabError("forbidden"));
    const user = await search("car");
    await user.click(await screen.findByRole("button", { name: fill(manage.add.addNamed, { name: "Carol Diaz" }) }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(within(screen.getByRole("list", { name: manage.people })).queryByText("Carol Diaz")).toBeNull();
    expect(screen.getByRole("textbox", { name: manage.add.label })).toHaveValue("car");
  });
});

describe("ManageSharing settings", () => {
  it("says when the link could not be copied", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderManage();
    await user.click(await screen.findByRole("button", { name: manage.link.copy }));
    expect(writeText).toHaveBeenCalledWith(shareInfo().link);
    expect(await screen.findByRole("button", { name: manage.link.copyFailed })).toBeInTheDocument();
  });

  it("treats a link role it cannot offer as view only", async () => {
    mocks.collabProjectSummary.mockResolvedValue(projectSummary({ link_sharing: true, link_role: "owner" }));
    mocks.collabLinkSharingSet.mockResolvedValue(projectSummary({ link_sharing: false, link_role: "viewer" }));
    const user = userEvent.setup();
    renderManage();
    expect(await screen.findByRole("combobox", { name: manage.link.roleLabel })).toHaveTextContent(roles.viewer);
    await user.click(screen.getByRole("switch", { name: manage.link.sharing }));
    expect(mocks.collabLinkSharingSet).toHaveBeenCalledWith("grant", false, "viewer");
  });

  it("keeps comments on when an older project's server answer arrives after switching projects", async () => {
    const stale = deferred<CollabCommentsStatus>();
    mocks.collabCommentsStatus.mockImplementation((projectId: string) =>
      projectId === "grant"
        ? stale.promise
        : Promise.resolve({ serverAllowed: true, projectEnabled: true, canComment: true }),
    );
    const view = renderManage();
    const toggle = await screen.findByRole("switch", { name: manage.comments.label });
    view.rerender(<ManageSharing projectId="thesis" name="Thesis" share={shareInfo({ project_id: "thesis" })} />);
    await waitFor(() => expect(mocks.collabCommentsStatus).toHaveBeenCalledWith("thesis"));
    await act(async () => stale.resolve({ serverAllowed: false, projectEnabled: true, canComment: false }));
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeEnabled();
    expect(screen.queryByText(fill(manage.comments.serverOff, { server: "Smith Lab" }))).toBeNull();
  });

  it("follows the stored access log switch when the project summary does not say", async () => {
    mocks.collabAccessLogStatus.mockResolvedValue({ serverAllowed: true, enabled: true });
    mocks.collabAccessLogSetEnabled.mockResolvedValue(projectSummary());
    const user = userEvent.setup();
    renderManage();
    const toggle = await screen.findByRole("switch", { name: manage.accessLog.label });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(mocks.collabAccessLogSetEnabled).toHaveBeenCalledWith("grant", false);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(useAccessLogSwitches.getState().byProject.grant).toEqual({ serverAllowed: true, enabled: false });
  });
});

describe("ManageSharing people and ending", () => {
  it("drops a list that loads late for the project it was first opened on", async () => {
    const stale = deferred<CollabProjectSummary>();
    mocks.collabProjectSummary.mockImplementation((projectId: string) =>
      projectId === "grant" ? stale.promise : Promise.resolve(projectSummary()),
    );
    mocks.collabMembersList.mockImplementation(async (projectId: string) =>
      projectId === "grant" ? [projectMember(BOB, "owner"), alice] : [projectMember(BOB, "owner"), projectMember(CAROL)],
    );
    const view = renderManage();
    await waitFor(() => expect(mocks.collabMembersList).toHaveBeenCalledWith("grant"));
    view.rerender(<ManageSharing projectId="thesis" name="Thesis" share={shareInfo({ project_id: "thesis" })} />);
    const list = await screen.findByRole("list", { name: manage.people });
    expect(within(list).getByText("Carol Diaz")).toBeInTheDocument();
    await act(async () => stale.resolve(projectSummary()));
    expect(within(list).queryByText("Alice Chen")).toBeNull();
    expect(within(list).getByText("Carol Diaz")).toBeInTheDocument();
  });

  it("does not show a load failure for a project it has moved away from", async () => {
    const stale = deferred<CollabProjectSummary>();
    mocks.collabProjectSummary.mockImplementation((projectId: string) =>
      projectId === "grant" ? stale.promise : Promise.resolve(projectSummary()),
    );
    const view = renderManage();
    await waitFor(() => expect(mocks.collabProjectSummary).toHaveBeenCalledWith("grant"));
    view.rerender(<ManageSharing projectId="thesis" name="Thesis" share={shareInfo({ project_id: "thesis" })} />);
    expect(await screen.findByRole("list", { name: manage.people })).toBeInTheDocument();
    await act(async () => stale.reject(collabError("unauthorized")));
    expect(screen.queryByText(manage.loadFailed)).toBeNull();
    expect(screen.getByRole("list", { name: manage.people })).toBeInTheDocument();
  });

  it("keeps each person's row busy until their own change ends", async () => {
    const carol = projectMember(CAROL, "editor");
    mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner"), alice, carol]);
    const forAlice = deferred<ReturnType<typeof projectMember>>();
    const forCarol = deferred<ReturnType<typeof projectMember>>();
    mocks.collabMemberSet.mockReset();
    mocks.collabMemberSet.mockImplementation((_project: string, accountId: string) =>
      accountId === alice.person.account_id ? forAlice.promise : forCarol.promise,
    );
    const user = userEvent.setup();
    renderManage();
    await screen.findByRole("list", { name: manage.people });
    await chooseOption(user, fill(manage.roleLabel, { name: "Alice Chen" }), roles.viewer);
    await chooseOption(user, fill(manage.roleLabel, { name: "Carol Diaz" }), roles.viewer);
    const removeCarol = screen.getByRole("button", { name: fill(manage.removeNamed, { name: "Carol Diaz" }) });
    expect(removeCarol).toBeDisabled();
    await act(async () => {
      forAlice.resolve(projectMember(person(), "viewer"));
      await forAlice.promise;
    });
    expect(screen.getByRole("button", { name: fill(manage.removeNamed, { name: "Alice Chen" }) })).toBeEnabled();
    expect(removeCarol).toBeDisabled();
    await act(async () => {
      forCarol.resolve(projectMember(CAROL, "viewer"));
      await forCarol.promise;
    });
    expect(removeCarol).toBeEnabled();
  });

  it("shows a failed role change on that person's row only", async () => {
    mocks.collabMemberSet.mockRejectedValue(collabError("forbidden"));
    const user = userEvent.setup();
    renderManage();
    const list = await screen.findByRole("list", { name: manage.people });
    await chooseOption(user, fill(manage.roleLabel, { name: "Alice Chen" }), roles.viewer);
    expect(mocks.collabMemberSet).toHaveBeenCalledWith("grant", alice.person.account_id, "viewer");
    const rows = within(list).getAllByRole("listitem");
    expect(await within(rows[1]).findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(within(rows[0]).queryByRole("alert")).toBeNull();
    expect(screen.getByRole("combobox", { name: fill(manage.roleLabel, { name: "Alice Chen" }) })).toHaveTextContent(
      roles.editor,
    );
  });

  it("stays open and says why when sharing cannot be stopped", async () => {
    mocks.collabStopSharing.mockRejectedValue(collabError("unreachable"));
    const user = userEvent.setup();
    renderManage();
    await user.click(await screen.findByRole("button", { name: manage.stop }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: manage.stopConfirm.confirm }));
    expect(mocks.collabStopSharing).toHaveBeenCalledWith("grant");
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(screen.getByRole("button", { name: manage.stop })).toBeEnabled();
    expect(useShareDialog.getState().projectId).toBe("grant");
  });
});

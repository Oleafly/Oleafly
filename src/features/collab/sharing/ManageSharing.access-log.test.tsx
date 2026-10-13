// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { BOB, collabError, projectMember, projectSummary, shareInfo } from "../tests/fixtures";
import { useAccessLogSwitches } from "./access-log-store";

const mocks = vi.hoisted(() => ({
  collabProjectSummary: vi.fn(),
  collabMembersList: vi.fn(),
  collabCommentsStatus: vi.fn(),
  collabAccessLogStatus: vi.fn(),
  collabAccessLogSetEnabled: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabProjectSummary: mocks.collabProjectSummary,
  collabMembersList: mocks.collabMembersList,
  collabCommentsStatus: mocks.collabCommentsStatus,
  collabAccessLogStatus: mocks.collabAccessLogStatus,
  collabAccessLogSetEnabled: mocks.collabAccessLogSetEnabled,
}));

import { ManageSharing } from "./ManageSharing";

const accessLog = enCollab.manage.accessLog;

function renderManage(role: "owner" | "editor" = "owner") {
  return render(<ManageSharing projectId="grant" name="Grant proposal" share={shareInfo({ role })} />);
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useAccessLogSwitches.setState({ byProject: {} });
  mocks.collabProjectSummary.mockResolvedValue(projectSummary({ access_log: false }));
  mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner")]);
  mocks.collabCommentsStatus.mockResolvedValue({ serverAllowed: true, projectEnabled: true, canComment: true });
  mocks.collabAccessLogStatus.mockResolvedValue({ serverAllowed: true, enabled: false });
});

describe("ManageSharing access log switch", () => {
  it("is off by default and lets the owner turn the log on and off", async () => {
    mocks.collabAccessLogSetEnabled
      .mockResolvedValueOnce(projectSummary({ access_log: true }))
      .mockResolvedValueOnce(projectSummary({ access_log: false }));
    const user = userEvent.setup();
    renderManage();
    const toggle = await screen.findByRole("switch", { name: accessLog.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(accessLog.description)).toBeInTheDocument();
    await user.click(toggle);
    expect(mocks.collabAccessLogSetEnabled).toHaveBeenCalledWith("grant", true);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(useAccessLogSwitches.getState().byProject.grant).toEqual({ serverAllowed: true, enabled: true });
    await user.click(toggle);
    expect(mocks.collabAccessLogSetEnabled).toHaveBeenLastCalledWith("grant", false);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(useAccessLogSwitches.getState().byProject.grant).toEqual({ serverAllowed: true, enabled: false });
  });

  it("puts the icon of each setting to the left of its title", async () => {
    mocks.collabProjectSummary.mockResolvedValue(projectSummary({ access_log: true, link_sharing: true }));
    renderManage();
    const rows: [string, string][] = [
      [enCollab.manage.link.sharing, "svg.lucide-link-2"],
      [enCollab.manage.comments.label, "svg.lucide-message-square"],
      [accessLog.label, "svg.lucide-scroll-text"],
    ];
    for (const [label, selector] of rows) {
      const toggle = await screen.findByRole("switch", { name: label });
      const icon = toggle.querySelector(selector);
      expect(icon, label).not.toBeNull();
      const title = within(toggle).getByText(label);
      expect(title.contains(icon), label).toBe(false);
      expect((icon as Element).compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING, label).toBeTruthy();
    }
  });

  it("is hidden when the server does not allow access logs", async () => {
    mocks.collabAccessLogStatus.mockResolvedValue({ serverAllowed: false, enabled: true });
    renderManage();
    expect(await screen.findByRole("switch", { name: enCollab.manage.comments.label })).toBeInTheDocument();
    await waitFor(() => expect(mocks.collabAccessLogStatus).toHaveBeenCalledWith("grant"));
    expect(screen.queryByRole("switch", { name: accessLog.label })).toBeNull();
  });

  it("keeps the old value and explains when the change fails", async () => {
    mocks.collabAccessLogSetEnabled.mockRejectedValue(collabError("forbidden"));
    const user = userEvent.setup();
    renderManage();
    await user.click(await screen.findByRole("switch", { name: accessLog.label }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(screen.getByRole("switch", { name: accessLog.label })).toHaveAttribute("aria-checked", "false");
  });

  it("is not offered to people who are not the owner", async () => {
    renderManage("editor");
    expect(await screen.findByRole("list", { name: enCollab.manage.people })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: accessLog.label })).toBeNull();
    expect(mocks.collabAccessLogStatus).not.toHaveBeenCalled();
  });
});

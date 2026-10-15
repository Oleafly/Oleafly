// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { BOB, collabError, fill, projectMember, projectSummary, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabProjectSummary: vi.fn(),
  collabMembersList: vi.fn(),
  collabCommentsStatus: vi.fn(),
  collabCommentsSetEnabled: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabProjectSummary: mocks.collabProjectSummary,
  collabMembersList: mocks.collabMembersList,
  collabCommentsStatus: mocks.collabCommentsStatus,
  collabCommentsSetEnabled: mocks.collabCommentsSetEnabled,
}));

import { ManageSharing } from "./ManageSharing";

const comments = enCollab.manage.comments;

function renderManage(role: "owner" | "editor" = "owner") {
  return render(<ManageSharing projectId="grant" name="Grant proposal" share={shareInfo({ role })} />);
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabProjectSummary.mockResolvedValue(projectSummary({ comments_enabled: true }));
  mocks.collabMembersList.mockResolvedValue([projectMember(BOB, "owner")]);
  mocks.collabCommentsStatus.mockResolvedValue({ serverAllowed: true, projectEnabled: true, canComment: true });
});

describe("ManageSharing comments switch", () => {
  it("lets the owner turn comments off and back on", async () => {
    mocks.collabCommentsSetEnabled
      .mockResolvedValueOnce(projectSummary({ comments_enabled: false }))
      .mockResolvedValueOnce(projectSummary({ comments_enabled: true }));
    const user = userEvent.setup();
    renderManage();
    const toggle = await screen.findByRole("switch", { name: comments.label });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(comments.description)).toBeInTheDocument();
    await user.click(toggle);
    expect(mocks.collabCommentsSetEnabled).toHaveBeenCalledWith("grant", false);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    await user.click(toggle);
    expect(mocks.collabCommentsSetEnabled).toHaveBeenLastCalledWith("grant", true);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("shows the switch off and locked when the server has comments turned off", async () => {
    mocks.collabCommentsStatus.mockResolvedValue({ serverAllowed: false, projectEnabled: true, canComment: false });
    const user = userEvent.setup();
    renderManage();
    expect(await screen.findByText(fill(comments.serverOff, { server: "Smith Lab" }))).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: comments.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(mocks.collabCommentsSetEnabled).not.toHaveBeenCalled();
  });

  it("keeps the old value and explains when the change fails", async () => {
    mocks.collabCommentsSetEnabled.mockRejectedValue(collabError("forbidden"));
    const user = userEvent.setup();
    renderManage();
    await user.click(await screen.findByRole("switch", { name: comments.label }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(screen.getByRole("switch", { name: comments.label })).toHaveAttribute("aria-checked", "true");
  });

  it("is not offered to people who are not the owner", async () => {
    renderManage("editor");
    expect(await screen.findByRole("list", { name: enCollab.manage.people })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: comments.label })).toBeNull();
    expect(mocks.collabCommentsStatus).not.toHaveBeenCalled();
  });
});

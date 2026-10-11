// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { ALICE_ID, BOB_ID, SERVER_ID, collabError, fill, member, securityEvent } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabAdminSecurityLog: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { SecurityLogTab, eventKindKey } from "./SecurityLogTab";

const copy = enCollab.admin.log;
const members = [member(), member({ account_id: BOB_ID, display_name: "Bob Smith" })];

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SecurityLogTab", () => {
  it("lists events with names, words and times, then loads older entries", async () => {
    mocks.collabAdminSecurityLog
      .mockResolvedValueOnce({
        items: [
          securityEvent(),
          securityEvent({ id: 2, actor: null, kind: "setup_completed", ip: null }),
          securityEvent({ id: 3, actor: BOB_ID, kind: "role_changed", target: ALICE_ID }),
        ],
        next_cursor: "c2",
      })
      .mockResolvedValueOnce({
        items: [
          securityEvent({
            id: 4,
            actor: "0192a0b0-0000-7000-8000-000000000999",
            kind: "member_removed",
            target: "someone-gone",
          }),
          securityEvent({ id: 5, kind: "unknown" }),
        ],
        next_cursor: null,
      });
    const user = userEvent.setup();
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    expect(mocks.collabAdminSecurityLog).toHaveBeenCalledWith(SERVER_ID);
    expect(items[0]).toHaveTextContent(`Alice Chen · ${copy.kinds.signIn}`);
    expect(items[0]).toHaveTextContent(fill(copy.ip, { ip: "203.0.113.7" }));
    expect(items[1]).toHaveTextContent(`${copy.server} · ${copy.kinds.setupCompleted}`);
    expect(items[2]).toHaveTextContent(`Bob Smith · ${copy.kinds.roleChanged}`);
    expect(items[2]).toHaveTextContent(fill(copy.target, { target: "Alice Chen" }));

    await user.click(screen.getByRole("button", { name: copy.loadMore }));
    expect(mocks.collabAdminSecurityLog).toHaveBeenLastCalledWith(SERVER_ID, "c2");
    expect(await screen.findByText(copy.unknownAccount)).toBeInTheDocument();
    const all = screen.getAllByRole("listitem");
    expect(all).toHaveLength(5);
    expect(all[3]).toHaveTextContent(fill(copy.target, { target: "someone-gone" }));
    expect(all[4]).toHaveTextContent(`Alice Chen · ${copy.kinds.unknown}`);
    expect(screen.queryByRole("button", { name: copy.loadMore })).toBeNull();
  });

  it("maps every security event kind to a label, and anything else to the neutral one", () => {
    for (const kind of [
      "setup_completed",
      "sign_in",
      "sign_in_refused",
      "device_added",
      "device_signed_out",
      "refresh_reuse_detected",
      "member_added",
      "member_removed",
      "member_suspended",
      "member_reactivated",
      "role_changed",
      "allowlist_added",
      "allowlist_removed",
      "domain_rule_added",
      "domain_rule_removed",
      "settings_changed",
    ]) {
      expect(eventKindKey(kind), kind).not.toBe("unknown");
      expect(Object.keys(copy.kinds)).toContain(eventKindKey(kind));
    }
    expect(eventKindKey("unknown")).toBe("unknown");
    expect(eventKindKey("project_shared")).toBe("unknown");
    expect(eventKindKey("hasOwnProperty")).toBe("unknown");
  });

  it("says when the log is empty", async () => {
    mocks.collabAdminSecurityLog.mockResolvedValue({ items: [], next_cursor: null });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
  });

  it("explains failures on the first page and on older pages", async () => {
    mocks.collabAdminSecurityLog
      .mockRejectedValueOnce(collabError("forbidden"))
      .mockResolvedValueOnce({ items: [securityEvent()], next_cursor: "c2" })
      .mockRejectedValueOnce(collabError("rate_limited"));
    const user = userEvent.setup();
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    expect(await screen.findByText(enCollab.errors.forbidden)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    await user.click(await screen.findByRole("button", { name: copy.loadMore }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.rate_limited);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

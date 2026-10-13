// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabEmailStatus } from "@/lib/tauri";
import { SERVER_ID, account, collabError, deferred, fill, server } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabAdminEmailStatus: vi.fn(),
  collabAdminEmailTest: vi.fn(),
  collabAdminPatchSettings: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { EmailTab, addServerLink } from "./EmailTab";

const copy = enCollab.admin.email;
const ADD_LINK = "oleafly://server/add?url=https%3A%2F%2Fcollab.uni.edu";

function status(overrides: Partial<CollabEmailStatus> = {}): CollabEmailStatus {
  return {
    configured: true,
    from: "Smith Lab <lab@uni.edu>",
    notifications: true,
    last_failure: null,
    ...overrides,
  };
}

function adminServer(emails = ["alice@uni.edu"]) {
  return server({ account: account({ server_role: "admin", emails }) });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addServerLink", () => {
  it("builds the link the app opens to add a server", () => {
    expect(addServerLink("https://collab.uni.edu")).toBe(ADD_LINK);
    expect(addServerLink("https://www.cs.uni.edu/oleafly/")).toBe(
      "oleafly://server/add?url=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly",
    );
  });
});

describe("EmailTab", () => {
  it("shows that email is on and who it comes from, then sends a test email", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status());
    mocks.collabAdminEmailTest.mockResolvedValue({ sent_to: ["alice@uni.edu"], delivered: true, error: null });
    const user = userEvent.setup();
    render(<EmailTab server={adminServer()} actor="admin" />);
    expect(await screen.findByText(copy.on.title)).toBeInTheDocument();
    expect(screen.getByText(fill(copy.on.from, { from: "Smith Lab <lab@uni.edu>" }))).toBeInTheDocument();
    expect(mocks.collabAdminEmailStatus).toHaveBeenCalledWith(SERVER_ID);
    expect(screen.getByText(fill(copy.test.description, { address: "alice@uni.edu" }))).toBeInTheDocument();
    expect(screen.queryByText(ADD_LINK)).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.test.send }));
    expect(mocks.collabAdminEmailTest).toHaveBeenCalledWith(SERVER_ID);
    expect(await screen.findByRole("status")).toHaveTextContent(fill(copy.test.sent, { address: "alice@uni.edu" }));
  });

  it("explains a test email the mail server refused", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status());
    mocks.collabAdminEmailTest.mockResolvedValue({
      sent_to: ["alice@uni.edu"],
      delivered: false,
      error: "transient error (451): 4.3.0 Try again later",
    });
    const user = userEvent.setup();
    render(<EmailTab server={adminServer()} actor="admin" />);
    await user.click(await screen.findByRole("button", { name: copy.test.send }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy.test.failed);
    expect(alert).toHaveTextContent("4.3.0 Try again later");
  });

  it("explains a test request the server turned down", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status());
    mocks.collabAdminEmailTest.mockRejectedValue(collabError("forbidden"));
    const user = userEvent.setup();
    render(<EmailTab server={adminServer()} actor="admin" />);
    await user.click(await screen.findByRole("button", { name: copy.test.send }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
  });

  it("says email is off, turns off every email control and offers the link to send yourself", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status({ configured: false, from: null }));
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<EmailTab server={adminServer()} actor="admin" />);
    expect(await screen.findByText(copy.off.title)).toBeInTheDocument();
    expect(screen.getByText(copy.off.description)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.test.send })).toBeDisabled();
    const notifications = screen.getByRole("switch", { name: enCollab.admin.settings.emailNotifications.label });
    expect(notifications).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText(copy.needsSettings)).toHaveLength(2);
    expect(screen.getByText(copy.off.copyPath)).toBeInTheDocument();
    expect(screen.getByText(ADD_LINK)).toBeInTheDocument();
    expect(screen.getByText("https://collab.uni.edu")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCollab.manage.link.copy }));
    expect(writeText).toHaveBeenCalledWith(ADD_LINK);
    expect(await screen.findByRole("button", { name: enCollab.manage.link.copied })).toBeInTheDocument();
    await user.click(notifications);
    expect(mocks.collabAdminPatchSettings).not.toHaveBeenCalled();
  });

  it("lets an admin turn email notifications off", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status());
    mocks.collabAdminPatchSettings.mockResolvedValue({ email_notifications: false });
    const user = userEvent.setup();
    render(<EmailTab server={adminServer()} actor="admin" />);
    const notifications = await screen.findByRole("switch", { name: enCollab.admin.settings.emailNotifications.label });
    expect(notifications).toHaveAttribute("aria-checked", "true");
    await user.click(notifications);
    expect(mocks.collabAdminPatchSettings).toHaveBeenCalledWith(SERVER_ID, { email_notifications: false });
    await waitFor(() => expect(notifications).toHaveAttribute("aria-checked", "false"));
  });

  it("puts the switch back when saving fails", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status());
    mocks.collabAdminPatchSettings.mockRejectedValue(collabError("unreachable"));
    const user = userEvent.setup();
    render(<EmailTab server={adminServer()} actor="admin" />);
    const notifications = await screen.findByRole("switch", { name: enCollab.admin.settings.emailNotifications.label });
    await user.click(notifications);
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(notifications).toHaveAttribute("aria-checked", "true");
  });

  it("is read-only for a maintainer", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status());
    const user = userEvent.setup();
    render(<EmailTab server={server({ account: account({ server_role: "maintainer" }) })} actor="maintainer" />);
    const notifications = await screen.findByRole("switch", { name: enCollab.admin.settings.emailNotifications.label });
    expect(notifications).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(enCollab.admin.settings.adminOnly)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.test.send })).toBeDisabled();
    expect(screen.getByText(copy.test.adminOnly)).toBeInTheDocument();
    await user.click(notifications);
    expect(mocks.collabAdminPatchSettings).not.toHaveBeenCalled();
  });

  it("says there is nowhere to send a test when the account has no verified address", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status());
    render(<EmailTab server={adminServer(["12345+alice@users.noreply.github.com"])} actor="admin" />);
    expect(await screen.findByText(copy.test.noAddress)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.test.send })).toBeDisabled();
  });

  it("shows the last email that failed", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(
      status({ last_failure: { at: 1_760_000_000_000, message: "Connection refused (os error 61)" } }),
    );
    render(<EmailTab server={adminServer()} actor="admin" />);
    expect(await screen.findByText("Connection refused (os error 61)")).toBeInTheDocument();
  });

  it("explains a failed load and tries again", async () => {
    mocks.collabAdminEmailStatus.mockRejectedValueOnce(collabError("unreachable")).mockResolvedValue(status());
    const user = userEvent.setup();
    render(<EmailTab server={adminServer()} actor="admin" />);
    expect(await screen.findByText(enCollab.admin.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unreachable)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText(copy.on.title)).toBeInTheDocument();
  });

  it("says when the link could not be copied", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status({ configured: false, from: null }));
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<EmailTab server={adminServer()} actor="admin" />);
    await user.click(await screen.findByRole("button", { name: enCollab.manage.link.copy }));
    expect(writeText).toHaveBeenCalledWith(ADD_LINK);
    expect(await screen.findByRole("button", { name: enCollab.manage.link.copyFailed })).toBeInTheDocument();
  });

  it("leaves out the sender when the server does not name one", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status({ from: null }));
    render(<EmailTab server={adminServer()} actor="admin" />);
    const state = await screen.findByTestId("collab-email-state");
    expect(state).toHaveTextContent(copy.on.title);
    expect(state.querySelectorAll("p")).toHaveLength(1);
  });

  it("shows only the refusal when the mail server gave no reason", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status());
    mocks.collabAdminEmailTest.mockResolvedValue({ sent_to: ["alice@uni.edu"], delivered: false, error: null });
    const user = userEvent.setup();
    render(<EmailTab server={adminServer()} actor="admin" />);
    await user.click(await screen.findByRole("button", { name: copy.test.send }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy.test.failed);
    expect(alert.querySelector("span")).toBeNull();
  });

  it("has nowhere to send a test when the server lists no account", async () => {
    mocks.collabAdminEmailStatus.mockResolvedValue(status());
    render(<EmailTab server={server({ account: null })} actor="admin" />);
    expect(await screen.findByText(copy.test.noAddress)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.test.send })).toBeDisabled();
  });

  it("shows the email state of the server now in view when an older answer comes back late", async () => {
    const slow = deferred<CollabEmailStatus>();
    const failing = deferred<CollabEmailStatus>();
    mocks.collabAdminEmailStatus
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce(status());
    const { rerender } = render(<EmailTab server={adminServer()} actor="admin" />);
    rerender(<EmailTab server={server({ server_id: "server-b", account: adminServer().account })} actor="admin" />);
    rerender(<EmailTab server={server({ server_id: "server-c", account: adminServer().account })} actor="admin" />);
    expect(await screen.findByText(copy.on.title)).toBeInTheDocument();
    await act(async () => {
      slow.resolve(status({ configured: false, from: null }));
      failing.reject(collabError("unreachable"));
      await Promise.allSettled([slow.promise, failing.promise]);
    });
    expect(screen.getByText(copy.on.title)).toBeInTheDocument();
    expect(screen.queryByText(copy.off.title)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.collabAdminEmailStatus).toHaveBeenLastCalledWith("server-c");
  });
});

// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabRuntimeSettings } from "@/lib/tauri";
import { SERVER_ID, collabError, deferred, runtimeSettings } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabAdminSettings: vi.fn(),
  collabAdminPatchSettings: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import {
  RUNTIME_SETTING_COPY,
  RUNTIME_SETTING_FIELDS,
  RuntimeSettingsTab,
  type RuntimeSettingField,
} from "./RuntimeSettingsTab";

const copy = enCollab.admin.settings;

function toggle(field: RuntimeSettingField): HTMLElement {
  return screen.getByRole("switch", { name: copy[RUNTIME_SETTING_COPY[field]].label });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RuntimeSettingsTab", () => {
  it("shows the settings that work today and saves one switch at a time for an admin", async () => {
    mocks.collabAdminSettings.mockResolvedValue(runtimeSettings({ directory_visible: false }));
    mocks.collabAdminPatchSettings.mockResolvedValue(runtimeSettings({ directory_visible: true }));
    const user = userEvent.setup();
    render(<RuntimeSettingsTab serverId={SERVER_ID} actor="admin" />);
    await screen.findByRole("switch", { name: copy.directoryVisible.label });
    expect(RUNTIME_SETTING_FIELDS).toEqual([
      "directory_visible",
      "directory_shows_email",
      "link_sharing_allowed",
      "access_logs_allowed",
      "comments_allowed",
      "email_link_sign_in",
      "guests_enabled",
      "guest_approval_required",
    ]);
    for (const field of RUNTIME_SETTING_FIELDS) expect(toggle(field)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: copy.emailNotifications.label })).toBeNull();
    expect(screen.queryByText(copy.adminOnly)).toBeNull();
    expect(toggle("directory_visible")).toHaveAttribute("aria-checked", "false");
    expect(toggle("directory_shows_email")).toHaveAttribute("aria-disabled", "true");

    await user.click(toggle("directory_visible"));
    expect(mocks.collabAdminPatchSettings).toHaveBeenCalledWith(SERVER_ID, { directory_visible: true });
    await waitFor(() => expect(toggle("directory_shows_email")).not.toHaveAttribute("aria-disabled"));
    expect(toggle("directory_visible")).toHaveAttribute("aria-checked", "true");
  });

  it("lets an admin turn on sign-in by email", async () => {
    mocks.collabAdminSettings.mockResolvedValue(runtimeSettings());
    mocks.collabAdminPatchSettings.mockResolvedValue(runtimeSettings({ email_link_sign_in: true }));
    const user = userEvent.setup();
    render(<RuntimeSettingsTab serverId={SERVER_ID} actor="admin" />);
    const emailSwitch = await screen.findByRole("switch", { name: copy.emailLinkSignIn.label });
    expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(copy.emailLinkSignIn.description)).toBeInTheDocument();
    await user.click(emailSwitch);
    expect(mocks.collabAdminPatchSettings).toHaveBeenCalledWith(SERVER_ID, { email_link_sign_in: true });
    await waitFor(() => expect(toggle("email_link_sign_in")).toHaveAttribute("aria-checked", "true"));
  });

  it("lets an admin allow guests and asks for approval only once guests are allowed", async () => {
    mocks.collabAdminSettings.mockResolvedValue(runtimeSettings());
    mocks.collabAdminPatchSettings.mockResolvedValue(runtimeSettings({ guests_enabled: true }));
    const user = userEvent.setup();
    render(<RuntimeSettingsTab serverId={SERVER_ID} actor="admin" />);
    const guests = await screen.findByRole("switch", { name: copy.guestsEnabled.label });
    expect(guests).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(copy.guestsEnabled.description)).toBeInTheDocument();
    expect(toggle("guest_approval_required")).toHaveAttribute("aria-disabled", "true");
    await user.click(guests);
    expect(mocks.collabAdminPatchSettings).toHaveBeenCalledWith(SERVER_ID, { guests_enabled: true });
    await waitFor(() => expect(toggle("guest_approval_required")).not.toHaveAttribute("aria-disabled"));
    expect(toggle("guest_approval_required")).toHaveAttribute("aria-checked", "true");
  });

  it("puts a switch back and explains when saving fails", async () => {
    mocks.collabAdminSettings.mockResolvedValue(runtimeSettings());
    mocks.collabAdminPatchSettings.mockRejectedValue(collabError("forbidden"));
    const user = userEvent.setup();
    render(<RuntimeSettingsTab serverId={SERVER_ID} actor="admin" />);
    await user.click(await screen.findByRole("switch", { name: copy.directoryVisible.label }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(toggle("directory_visible")).toHaveAttribute("aria-checked", "true");
  });

  it("shows the settings read-only to a maintainer", async () => {
    mocks.collabAdminSettings.mockResolvedValue(runtimeSettings({ directory_visible: false }));
    const user = userEvent.setup();
    render(<RuntimeSettingsTab serverId={SERVER_ID} actor="maintainer" />);
    expect(await screen.findByText(copy.adminOnly)).toBeInTheDocument();
    for (const field of RUNTIME_SETTING_FIELDS) expect(toggle(field)).toHaveAttribute("aria-disabled", "true");
    await user.click(toggle("link_sharing_allowed"));
    expect(mocks.collabAdminPatchSettings).not.toHaveBeenCalled();
  });

  it("explains a failed load", async () => {
    mocks.collabAdminSettings.mockRejectedValue(collabError("unauthorized"));
    render(<RuntimeSettingsTab serverId={SERVER_ID} actor="admin" />);
    expect(await screen.findByText(enCollab.admin.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unauthorized)).toBeInTheDocument();
  });

  it("shows the settings of the server now in view when an older answer comes back late", async () => {
    const slow = deferred<CollabRuntimeSettings>();
    const failing = deferred<CollabRuntimeSettings>();
    mocks.collabAdminSettings
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce(runtimeSettings({ directory_visible: false }));
    const { rerender } = render(<RuntimeSettingsTab serverId="server-a" actor="admin" />);
    rerender(<RuntimeSettingsTab serverId="server-b" actor="admin" />);
    rerender(<RuntimeSettingsTab serverId={SERVER_ID} actor="admin" />);
    expect(await screen.findByRole("switch", { name: copy.directoryVisible.label })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await act(async () => {
      slow.resolve(runtimeSettings({ directory_visible: true }));
      failing.reject(collabError("forbidden"));
      await Promise.allSettled([slow.promise, failing.promise]);
    });
    expect(toggle("directory_visible")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { SERVER_ID, collabError, runtimeSettings } from "./tests/fixtures";

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
    expect(RUNTIME_SETTING_FIELDS).toEqual(["directory_visible", "directory_shows_email", "link_sharing_allowed"]);
    for (const field of RUNTIME_SETTING_FIELDS) expect(toggle(field)).toBeInTheDocument();
    for (const hidden of [copy.guestsEnabled, copy.guestApprovalRequired, copy.accessLogsAllowed, copy.emailNotifications]) {
      expect(screen.queryByRole("switch", { name: hidden.label })).toBeNull();
    }
    expect(screen.queryByText(copy.adminOnly)).toBeNull();
    expect(toggle("directory_visible")).toHaveAttribute("aria-checked", "false");
    expect(toggle("directory_shows_email")).toHaveAttribute("aria-disabled", "true");

    await user.click(toggle("directory_visible"));
    expect(mocks.collabAdminPatchSettings).toHaveBeenCalledWith(SERVER_ID, { directory_visible: true });
    await waitFor(() => expect(toggle("directory_shows_email")).not.toHaveAttribute("aria-disabled"));
    expect(toggle("directory_visible")).toHaveAttribute("aria-checked", "true");
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
});

// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabEmailPreferences } from "@/lib/tauri";
import { SERVER_ID, collabError } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabEmailPreferences: vi.fn(),
  collabSetEmailPreferences: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { EmailPreferencesRow } from "./EmailPreferencesRow";

const copy = enCollab.section.server.emails;

function preferences(overrides: Partial<CollabEmailPreferences> = {}): CollabEmailPreferences {
  return { shared_with_you: true, mail_configured: true, notifications: true, ...overrides };
}

function toggle(): HTMLElement {
  return screen.getByRole("switch", { name: copy.label });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EmailPreferencesRow", () => {
  it("lets a person turn off emails about projects shared with them", async () => {
    mocks.collabEmailPreferences.mockResolvedValue(preferences());
    mocks.collabSetEmailPreferences.mockResolvedValue(preferences({ shared_with_you: false }));
    const user = userEvent.setup();
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    await screen.findByRole("switch", { name: copy.label });
    expect(mocks.collabEmailPreferences).toHaveBeenCalledWith(SERVER_ID);
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(copy.description)).toBeInTheDocument();
    await user.click(toggle());
    expect(mocks.collabSetEmailPreferences).toHaveBeenCalledWith(SERVER_ID, { shared_with_you: false });
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "false"));
  });

  it("puts the switch back when saving fails", async () => {
    mocks.collabEmailPreferences.mockResolvedValue(preferences());
    mocks.collabSetEmailPreferences.mockRejectedValue(collabError("unreachable"));
    const user = userEvent.setup();
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    await user.click(await screen.findByRole("switch", { name: copy.label }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  it("says so when the server sends no email", async () => {
    mocks.collabEmailPreferences.mockResolvedValue(preferences({ mail_configured: false }));
    const user = userEvent.setup();
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    expect(await screen.findByText(copy.noMail)).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-disabled", "true");
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    await user.click(toggle());
    expect(mocks.collabSetEmailPreferences).not.toHaveBeenCalled();
  });

  it("says so when the admin has turned email off", async () => {
    mocks.collabEmailPreferences.mockResolvedValue(preferences({ notifications: false }));
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    expect(await screen.findByText(copy.paused)).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-disabled", "true");
  });

  it("says so quietly when the setting cannot load", async () => {
    mocks.collabEmailPreferences.mockRejectedValue(collabError("unreachable"));
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

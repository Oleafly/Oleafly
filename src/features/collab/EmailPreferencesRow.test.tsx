// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
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
  return { shared_with_you: true, mentions: true, mail_configured: true, notifications: true, ...overrides };
}

function toggle(): HTMLElement {
  return screen.getByRole("switch", { name: copy.label });
}

function mentionsToggle(): HTMLElement {
  return screen.getByRole("switch", { name: copy.mentionsLabel });
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

  it("puts the mail icon to the left of the title, like the share dialog settings", async () => {
    mocks.collabEmailPreferences.mockResolvedValue(preferences());
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    const row = await screen.findByRole("switch", { name: copy.label });
    const icon = row.querySelector("svg.lucide-mail") as Element;
    const title = screen.getByText(copy.label);
    expect(title.contains(icon)).toBe(false);
    expect(icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("lets a person turn off emails about mentions, right under the share setting", async () => {
    mocks.collabEmailPreferences.mockResolvedValue(preferences());
    mocks.collabSetEmailPreferences.mockResolvedValue(preferences({ mentions: false }));
    const user = userEvent.setup();
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    await screen.findByRole("switch", { name: copy.mentionsLabel });
    expect(screen.getByText(copy.mentionsDescription)).toBeInTheDocument();
    expect(toggle().compareDocumentPosition(mentionsToggle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mentionsToggle()).toHaveAttribute("aria-checked", "true");
    await user.click(mentionsToggle());
    expect(mocks.collabSetEmailPreferences).toHaveBeenCalledWith(SERVER_ID, { mentions: false });
    await waitFor(() => expect(mentionsToggle()).toHaveAttribute("aria-checked", "false"));
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  it("puts the mentions switch back when saving fails", async () => {
    mocks.collabEmailPreferences.mockResolvedValue(preferences());
    mocks.collabSetEmailPreferences.mockRejectedValue(collabError("unreachable"));
    const user = userEvent.setup();
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    await user.click(await screen.findByRole("switch", { name: copy.mentionsLabel }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(mentionsToggle()).toHaveAttribute("aria-checked", "true");
  });

  it("turns the mentions switch off with the rest when the server sends no email", async () => {
    mocks.collabEmailPreferences.mockResolvedValue(preferences({ mail_configured: false }));
    const user = userEvent.setup();
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    await screen.findByRole("switch", { name: copy.mentionsLabel });
    expect(mentionsToggle()).toHaveAttribute("aria-disabled", "true");
    expect(mentionsToggle()).toHaveAttribute("aria-checked", "false");
    await user.click(mentionsToggle());
    expect(mocks.collabSetEmailPreferences).not.toHaveBeenCalled();
  });

  it("leaves out the mentions switch for a server that does not send mention emails", async () => {
    const older: CollabEmailPreferences = { shared_with_you: true, mail_configured: true, notifications: true };
    mocks.collabEmailPreferences.mockResolvedValue(older);
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    await screen.findByRole("switch", { name: copy.label });
    expect(screen.queryByRole("switch", { name: copy.mentionsLabel })).toBeNull();
    expect(screen.queryByText(copy.mentionsDescription)).toBeNull();
  });

  it("ignores a late failure from the server it showed before", async () => {
    let failEarlier: (reason: unknown) => void = () => undefined;
    mocks.collabEmailPreferences
      .mockReturnValueOnce(new Promise((_resolve, reject) => (failEarlier = reject)))
      .mockResolvedValue(preferences());
    const view = render(<EmailPreferencesRow serverId="server-old" />);
    view.rerender(<EmailPreferencesRow serverId={SERVER_ID} />);
    await screen.findByRole("switch", { name: copy.label });
    await act(async () => failEarlier(collabError("unreachable")));
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  it("says so quietly when the setting cannot load", async () => {
    mocks.collabEmailPreferences.mockRejectedValue(collabError("unreachable"));
    render(<EmailPreferencesRow serverId={SERVER_ID} />);
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

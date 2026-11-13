// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabAdminPublishedNote } from "@oleafly/backend-port";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { SERVER_ID, collabError, fill } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabAdminPublishedNotes: vi.fn(),
  collabAdminSetNoteTakenDown: vi.fn(),
  openInSystemBrowser: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabAdminPublishedNotes: mocks.collabAdminPublishedNotes,
  collabAdminSetNoteTakenDown: mocks.collabAdminSetNoteTakenDown,
}));
vi.mock("@/lib/system-browser", () => ({ openInSystemBrowser: mocks.openInSystemBrowser }));

import { PublishedNotesSection } from "./PublishedNotesSection";

const pages = enCollab.console.pages;
const NOW = 1_762_000_600_000;

function entry(overrides: Partial<CollabAdminPublishedNote["note"]> = {}, author: CollabAdminPublishedNote["author"] = null) {
  return {
    note: {
      id: "0192a0b0-0000-7000-8000-0000000000f1",
      source: "n-42",
      title: "Reef survey",
      url: "https://collab.uni.edu/n/AbCdEfGhIjKlMnOp",
      size: 2048,
      published_at: NOW - 60_000,
      updated_at: NOW - 60_000,
      taken_down: false,
      ...overrides,
    },
    author,
  };
}

const ALICE = {
  account_id: "0192a0b0-0000-7000-8000-0000000000c2",
  display_name: "Alice Chen",
  avatar_url: null,
  email: "alice@uni.edu",
  login: "alice",
  guest: false,
  active: true,
};

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PublishedNotesSection", () => {
  it("lists every published note with its author and takes one down after asking", async () => {
    mocks.collabAdminPublishedNotes.mockResolvedValue([entry({}, ALICE)]);
    mocks.collabAdminSetNoteTakenDown.mockResolvedValue(entry({ taken_down: true }, ALICE));
    const user = userEvent.setup();
    render(<PublishedNotesSection serverId={SERVER_ID} now={NOW} />);
    expect(await screen.findByText("Alice Chen")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: fill(pages.openNamed, { title: "Reef survey" }) }));
    expect(mocks.openInSystemBrowser).toHaveBeenCalledWith("https://collab.uni.edu/n/AbCdEfGhIjKlMnOp");

    await user.click(screen.getByRole("button", { name: fill(pages.takeDownNamed, { title: "Reef survey" }) }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(pages.takeDownConfirm.description);
    await user.click(within(dialog).getByRole("button", { name: pages.takeDownConfirm.confirm }));
    await waitFor(() =>
      expect(mocks.collabAdminSetNoteTakenDown).toHaveBeenCalledWith(SERVER_ID, "0192a0b0-0000-7000-8000-0000000000f1", true),
    );
    expect(await screen.findByText(pages.takenDown)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: fill(pages.restoreNamed, { title: "Reef survey" }) })).toBeEnabled();
  });

  it("puts a page back without asking and says when a change fails", async () => {
    mocks.collabAdminPublishedNotes.mockResolvedValue([entry({ taken_down: true })]);
    mocks.collabAdminSetNoteTakenDown.mockRejectedValueOnce(collabError("forbidden")).mockResolvedValue(entry());
    const user = userEvent.setup();
    render(<PublishedNotesSection serverId={SERVER_ID} now={NOW} />);
    expect(await screen.findByText(pages.noAuthor)).toBeInTheDocument();
    const restore = screen.getByRole("button", { name: fill(pages.restoreNamed, { title: "Reef survey" }) });
    await user.click(restore);
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    await user.click(restore);
    await waitFor(() => expect(screen.queryByText(pages.takenDown)).not.toBeInTheDocument());
  });

  it("says when nobody has published anything", async () => {
    mocks.collabAdminPublishedNotes.mockResolvedValue([]);
    render(<PublishedNotesSection serverId={SERVER_ID} now={NOW} />);
    expect(await screen.findByText(pages.empty)).toBeInTheDocument();
  });
});

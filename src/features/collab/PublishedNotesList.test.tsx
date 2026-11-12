// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { SERVER_ID, collabError, fill } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabPublishedNotes: vi.fn(),
  collabUnpublishNote: vi.fn(),
  openInSystemBrowser: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabPublishedNotes: mocks.collabPublishedNotes,
  collabUnpublishNote: mocks.collabUnpublishNote,
}));
vi.mock("@/lib/system-browser", () => ({ openInSystemBrowser: mocks.openInSystemBrowser }));

import { PublishedNotesList } from "./PublishedNotesList";

const list = enCollab.publish.list;
const NOTE = {
  id: "0192a0b0-0000-7000-8000-0000000000f1",
  source: "n-42",
  title: "Reading notes",
  url: "https://collab.uni.edu/n/AbCdEfGhIjKlMnOp",
  size: 2048,
  published_at: 1_762_000_500_000,
  updated_at: 1_762_000_500_000,
};

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PublishedNotesList", () => {
  it("stays out of the way on a server that does not allow public links", async () => {
    mocks.collabPublishedNotes.mockResolvedValue({ allowed: false, notes: [] });
    const { container } = render(<PublishedNotesList serverId={SERVER_ID} />);
    await waitFor(() => expect(mocks.collabPublishedNotes).toHaveBeenCalledWith(SERVER_ID));
    expect(container).toBeEmptyDOMElement();
  });

  it("stays hidden on a server too old to have public pages", async () => {
    mocks.collabPublishedNotes.mockRejectedValue(collabError("not_found"));
    const { container } = render(<PublishedNotesList serverId={SERVER_ID} />);
    await waitFor(() => expect(mocks.collabPublishedNotes).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("marks a page an admin took down", async () => {
    mocks.collabPublishedNotes.mockResolvedValue({ allowed: true, notes: [{ ...NOTE, taken_down: true }] });
    render(<PublishedNotesList serverId={SERVER_ID} />);
    expect(await screen.findByText(enCollab.console.pages.takenDown)).toBeInTheDocument();
  });

  it("says when nothing is published yet", async () => {
    mocks.collabPublishedNotes.mockResolvedValue({ allowed: true, notes: [] });
    render(<PublishedNotesList serverId={SERVER_ID} />);
    expect(await screen.findByText(list.empty)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: list.title })).toBeInTheDocument();
  });

  it("lists published notes even after public links were turned off, and unpublishes one", async () => {
    mocks.collabPublishedNotes.mockResolvedValue({ allowed: false, notes: [NOTE] });
    mocks.collabUnpublishNote.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PublishedNotesList serverId={SERVER_ID} />);

    await user.click(await screen.findByRole("button", { name: fill(list.openNamed, { name: NOTE.title }) }));
    expect(mocks.openInSystemBrowser).toHaveBeenCalledWith(NOTE.url);
    await user.click(screen.getByRole("button", { name: fill(list.unpublishNamed, { name: NOTE.title }) }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: enCollab.publish.unpublishConfirm.confirm }));
    await waitFor(() => expect(mocks.collabUnpublishNote).toHaveBeenCalledWith(SERVER_ID, NOTE.id));
    await waitFor(() => expect(screen.queryByRole("heading", { name: list.title })).not.toBeInTheDocument());
  });

  it("offers a retry when the list cannot load", async () => {
    mocks.collabPublishedNotes.mockRejectedValueOnce(collabError("unreachable")).mockResolvedValue({ allowed: true, notes: [NOTE] });
    const user = userEvent.setup();
    render(<PublishedNotesList serverId={SERVER_ID} />);
    expect(await screen.findByText(list.loadFailed)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByText(NOTE.title)).toBeInTheDocument();
  });
});

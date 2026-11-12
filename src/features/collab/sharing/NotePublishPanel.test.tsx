// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabPublishedNote } from "@oleafly/backend-port";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useFilesStore } from "@/store/files";
import { useCollabStore } from "../store";
import { BOB_ID, SERVER_ID, account, collabError, fill, libraryProject, server, shareCheck, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabShareInfo: vi.fn(),
  collabShareCheck: vi.fn(),
  collabServersList: vi.fn(),
  collabPublishedNotes: vi.fn(),
  collabPublishNote: vi.fn(),
  collabUnpublishNote: vi.fn(),
  onCollabShareProgress: vi.fn(),
  notePage: vi.fn(),
  noteSourceId: vi.fn(),
  openInSystemBrowser: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabShareInfo: mocks.collabShareInfo,
  collabShareCheck: mocks.collabShareCheck,
  collabServersList: mocks.collabServersList,
  collabPublishedNotes: mocks.collabPublishedNotes,
  collabPublishNote: mocks.collabPublishNote,
  collabUnpublishNote: mocks.collabUnpublishNote,
  onCollabShareProgress: mocks.onCollabShareProgress,
}));
vi.mock("@/components/notes/note-publish", () => ({ notePage: mocks.notePage, noteSourceId: mocks.noteSourceId }));
vi.mock("@/lib/system-browser", () => ({ openInSystemBrowser: mocks.openInSystemBrowser }));

import { ShareDialog } from "./ShareDialog";

const publish = enCollab.publish;
const NOTE = libraryProject({ id: "note-1", name: "Reading notes", main_doc: "note.md", kind: "note", updated_at: 1_762_000_000 });
const URL = "https://collab.uni.edu/n/AbCdEfGhIjKlMnOp";

function page(overrides: Partial<CollabPublishedNote> = {}): CollabPublishedNote {
  return {
    id: "0192a0b0-0000-7000-8000-0000000000f1",
    source: "n-42",
    title: "Reading notes",
    url: URL,
    size: 2048,
    published_at: 1_762_000_500_000,
    updated_at: 1_762_000_500_000,
    ...overrides,
  };
}

async function openPublishTab() {
  const user = userEvent.setup();
  useShareDialog.setState({ projectId: NOTE.id, fromCopy: false });
  render(<ShareDialog projectId={NOTE.id} />);
  await user.click(await screen.findByRole("tab", { name: publish.tabs.publish }));
  return user;
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabServersList.mockResolvedValue([server({ account: account({ account_id: BOB_ID }) })]);
  mocks.collabShareInfo.mockResolvedValue(null);
  mocks.collabShareCheck.mockResolvedValue(shareCheck());
  mocks.onCollabShareProgress.mockResolvedValue(() => {});
  mocks.noteSourceId.mockResolvedValue("n-42");
  mocks.collabPublishedNotes.mockResolvedValue({ allowed: true, notes: [] });
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {} });
  useFilesStore.setState({ projectId: null, projects: [NOTE] });
});

describe("publishing a note from its Share dialog", () => {
  it("publishes a rendered copy and then shows its public link", async () => {
    const upload = { source: "n-42", title: "Reading notes", html: "<p>Hi</p>" };
    mocks.notePage.mockResolvedValue(upload);
    mocks.collabPublishNote.mockResolvedValue(page());
    const user = await openPublishTab();

    expect(await screen.findByText(publish.contents)).toBeInTheDocument();
    expect(screen.getByText(publish.intro)).toBeInTheDocument();
    expect(mocks.collabPublishedNotes).toHaveBeenCalledWith(SERVER_ID);
    await user.click(screen.getByRole("button", { name: publish.publish }));

    expect(await screen.findByTestId("note-public-link")).toHaveTextContent(URL);
    expect(mocks.notePage).toHaveBeenCalledWith(NOTE);
    expect(mocks.collabPublishNote).toHaveBeenCalledWith(SERVER_ID, upload);
    expect(screen.getByRole("button", { name: publish.republish })).toBeEnabled();
    expect(screen.queryByText(publish.stale)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: publish.open }));
    expect(mocks.openInSystemBrowser).toHaveBeenCalledWith(URL);
  });

  it("says when the note changed after it was published and unpublishes after asking", async () => {
    mocks.collabPublishedNotes.mockResolvedValue({ allowed: true, notes: [page({ updated_at: 1_761_000_000_000 })] });
    mocks.collabUnpublishNote.mockResolvedValue(undefined);
    const user = await openPublishTab();

    expect(await screen.findByText(publish.stale)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: publish.unpublish }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(fill(publish.unpublishConfirm.title, { name: "Reading notes" }));
    await user.click(within(dialog).getByRole("button", { name: publish.unpublishConfirm.confirm }));

    await waitFor(() => expect(mocks.collabUnpublishNote).toHaveBeenCalledWith(SERVER_ID, page().id));
    await waitFor(() => expect(screen.queryByTestId("note-public-link")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: publish.publish })).toBeEnabled();
  });

  it("explains a server that does not allow public links and keeps Publish off", async () => {
    mocks.collabPublishedNotes.mockResolvedValue({ allowed: false, notes: [] });
    await openPublishTab();
    expect(await screen.findByText(fill(publish.notAllowed, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: publish.publish })).toBeDisabled();
  });

  it("says when the server is too old for public pages", async () => {
    mocks.collabPublishedNotes.mockRejectedValue(collabError("not_found"));
    await openPublishTab();
    expect(await screen.findByText(fill(publish.tooOld, { server: "Smith Lab" }))).toBeInTheDocument();
    expect(screen.queryByText(fill(publish.notAllowed, { server: "Smith Lab" }))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: publish.publish })).toBeDisabled();
  });

  it("explains a page an admin took down and keeps it from being published again", async () => {
    mocks.collabPublishedNotes.mockResolvedValue({ allowed: true, notes: [page({ taken_down: true, updated_at: 1 })] });
    await openPublishTab();
    expect(await screen.findByText(publish.takenDown)).toBeInTheDocument();
    expect(screen.queryByText(publish.stale)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: publish.republish })).toBeDisabled();
    expect(screen.getByRole("button", { name: publish.unpublish })).toBeEnabled();
  });

  it("shows why publishing failed and keeps the note unpublished", async () => {
    mocks.notePage.mockResolvedValue({ source: "n-42", title: "Reading notes", html: "<p>Hi</p>" });
    mocks.collabPublishNote.mockRejectedValue(collabError("page_too_large"));
    const user = await openPublishTab();
    await user.click(await screen.findByRole("button", { name: publish.publish }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`${publish.failed} ${enCollab.errors.page_too_large}`);
    expect(screen.queryByTestId("note-public-link")).not.toBeInTheDocument();
  });

  it("leaves publishing a shared note to its owner", async () => {
    mocks.collabShareInfo.mockResolvedValue(shareInfo({ project_id: NOTE.id, role: "editor" }));
    await openPublishTab();
    expect(await screen.findByText(publish.ownerOnly)).toBeInTheDocument();
    expect(mocks.collabPublishedNotes).not.toHaveBeenCalled();
  });
});

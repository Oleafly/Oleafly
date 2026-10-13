// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabLiveKeptFile, CollabUploadFile } from "@/lib/tauri";
import { BOB, BOB_ID, projectMember, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabUploadRetry: vi.fn(),
  collabUploadDismiss: vi.fn(),
  collabLocalCopyBringIn: vi.fn(),
  collabLocalCopyDecline: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabUploadRetry: mocks.collabUploadRetry,
  collabUploadDismiss: mocks.collabUploadDismiss,
  collabLocalCopyBringIn: mocks.collabLocalCopyBringIn,
  collabLocalCopyDecline: mocks.collabLocalCopyDecline,
}));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({ projectId: "paper" as string | null })),
    onPathsMoved: () => () => {},
  };
});

import { useFilesStore } from "@/store/files";
import { FileNoticesBanner } from "./FileNoticesBanner";
import { useFileNotices } from "./file-notices";
import { useCollabLiveStore } from "./live-store";

const copy = enCollab.files;

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, value), template);
}

function upload(overrides: Partial<CollabUploadFile> = {}): CollabUploadFile {
  return { path: "figures/plot.png", state: "waiting", size: 2048, limit: null, ...overrides };
}

function kept(overrides: Partial<CollabLiveKeptFile> = {}): CollabLiveKeptFile {
  return {
    id: "copy-id",
    path: "figures/plot.png",
    copy: "figures/plot (from Alice Chen).png",
    kind: "replaced",
    by: BOB_ID,
    ...overrides,
  };
}

function show(uploads: CollabUploadFile[], keptFiles: CollabLiveKeptFile[] = []) {
  act(() => useFileNotices.setState({ projectId: "paper", uploads, kept: keptFiles, retrying: false }));
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabUploadRetry.mockResolvedValue(undefined);
  mocks.collabUploadDismiss.mockResolvedValue(undefined);
  mocks.collabLocalCopyBringIn.mockResolvedValue(undefined);
  mocks.collabLocalCopyDecline.mockResolvedValue(undefined);
  useFilesStore.setState({ projectId: "paper" });
  useCollabLiveStore.setState({
    projectId: "paper",
    share: shareInfo({ role: "editor" }),
    role: "editor",
    members: [projectMember(BOB, "owner")],
  });
});

afterEach(() => {
  useFileNotices.setState({
    projectId: null,
    uploads: [],
    kept: [],
    retrying: false,
    offer: null,
    bringing: false,
    offerFailure: null,
    broughtIn: null,
  });
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, members: [] });
});

describe("FileNoticesBanner", () => {
  it("shows nothing when every figure is shared and nothing was kept", () => {
    const { container } = render(<FileNoticesBanner />);
    expect(container.textContent).toBe("");
  });

  it("names the figures waiting to be shared and retries them", async () => {
    render(<FileNoticesBanner />);
    show([upload(), upload({ path: "figures/map.png" })]);
    expect(screen.getByText(fill(copy.waiting, { files: "plot.png and map.png" }))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: copy.retry }));
    expect(mocks.collabUploadRetry).toHaveBeenCalledWith("paper");
  });

  it("says which figures could not be shared after the retries ran out", () => {
    render(<FileNoticesBanner />);
    show([upload({ state: "failed" })]);
    expect(screen.getByText(fill(copy.failed, { files: "plot.png" }))).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.retry })).toBeTruthy();
  });

  it("names a figure that is too large with its size and the server limit and lets it be dismissed", async () => {
    render(<FileNoticesBanner />);
    show([upload({ path: "figures/big60.png", state: "too_large", size: 60 * 1024 * 1024, limit: 50 * 1024 * 1024 })]);
    expect(screen.getByText(fill(copy.tooLarge, { file: "big60.png", size: "60 MB", limit: "50 MB" }))).toBeTruthy();
    expect(screen.queryByRole("button", { name: copy.retry })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: copy.dismiss }));
    expect(mocks.collabUploadDismiss).toHaveBeenCalledWith("paper", "figures/big60.png");
    expect(screen.queryByText(/big60\.png/)).toBeNull();
  });

  it("tells the person whose figure lost a replacement where their version went", async () => {
    render(<FileNoticesBanner />);
    show([], [kept(), kept({ id: "plan-id", kind: "added", path: "plan.tex", copy: "plan (from Alice Chen).tex", by: null })]);
    expect(
      screen.getByText(
        fill(copy.replaced, { name: "Bob Smith", file: "plot.png", copy: "plot (from Alice Chen).png" }),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(fill(copy.added, { file: "plan.tex", copy: "plan (from Alice Chen).tex", name: "Someone" })),
    ).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: copy.dismiss })[0]);
    expect(useFileNotices.getState().kept.map((file) => file.id)).toEqual(["plan-id"]);
  });

  it("offers to bring in the changes made in the local copy and confirms once they are in", async () => {
    const offer = { copyId: "paper-copy", name: "R4 Paper (local copy)", files: ["main.tex", "figures/plot.png"] };
    render(<FileNoticesBanner />);
    act(() => useFileNotices.setState({ projectId: "paper", offer }));
    expect(
      screen.getByText(fill(copy.localCopy, { files: "main.tex and plot.png", name: "R4 Paper (local copy)" })),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: copy.bringIn }));
    expect(mocks.collabLocalCopyBringIn).toHaveBeenCalledWith("paper", "paper-copy");
    expect(screen.queryByRole("button", { name: copy.bringIn })).toBeNull();
    expect(screen.getByText(fill(copy.broughtIn, { name: "R4 Paper (local copy)" }))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: copy.dismiss }));
    expect(screen.queryByText(fill(copy.broughtIn, { name: "R4 Paper (local copy)" }))).toBeNull();
  });

  it("keeps the local copy separate when the person says so", async () => {
    const offer = { copyId: "paper-copy", name: "R4 Paper (local copy)", files: ["main.tex"] };
    render(<FileNoticesBanner />);
    act(() => useFileNotices.setState({ projectId: "paper", offer }));
    await userEvent.click(screen.getByRole("button", { name: copy.keepSeparate }));
    expect(mocks.collabLocalCopyDecline).toHaveBeenCalledWith("paper", "paper-copy");
    expect(screen.queryByRole("button", { name: copy.bringIn })).toBeNull();
  });

  it("tells the person whose file kept its name where the other person's file went", () => {
    render(<FileNoticesBanner />);
    show([], [kept({ id: "theirs-id", kind: "beside", path: "sections/plan.tex", copy: "sections/plan (from Bob Smith).tex" })]);
    expect(
      screen.getByText(fill(copy.beside, { name: "Bob Smith", file: "plan.tex", copy: "plan (from Bob Smith).tex" })),
    ).toBeTruthy();
  });
});

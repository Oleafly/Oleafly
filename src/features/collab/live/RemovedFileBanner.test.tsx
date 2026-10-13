// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { BOB, BOB_ID, CAROL_ID, projectMember, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabTrashRestore: vi.fn(),
  collabLiveFlush: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabTrashRestore: mocks.collabTrashRestore,
  collabLiveFlush: mocks.collabLiveFlush,
}));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: "paper" as string | null,
      tree: [] as { path: string; is_dir: boolean }[],
      refreshTree: vi.fn(async () => true),
      openFile: vi.fn(async () => {}),
    })),
    onPathsMoved: () => () => {},
  };
});

import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "./live-store";
import { type RemovedNotice, useRemovedNotices } from "./removed-notices";
import { RemovedFileBanner } from "./RemovedFileBanner";

const copy = enCollab.removed;

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, value), template);
}

function notice(overrides: Partial<RemovedNotice> = {}): RemovedNotice {
  return { id: "results-id", path: "sections/results.tex", kind: "text", by: BOB_ID, yours: false, ...overrides };
}

function show(...notices: RemovedNotice[]) {
  act(() => useRemovedNotices.setState({ projectId: "paper", notices, restoring: null, failure: null }));
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabTrashRestore.mockResolvedValue(undefined);
  mocks.collabLiveFlush.mockResolvedValue(undefined);
  useFilesStore.setState({ projectId: "paper" });
  useCollabLiveStore.setState({
    projectId: "paper",
    share: shareInfo({ role: "editor" }),
    role: "editor",
    members: [projectMember(BOB, "owner")],
  });
});

afterEach(() => {
  useRemovedNotices.setState({ projectId: null, notices: [], restoring: null, failure: null });
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, members: [] });
});

describe("RemovedFileBanner", () => {
  it("says who deleted the open file and brings it back with Restore", async () => {
    render(<RemovedFileBanner />);
    show(notice());
    expect(screen.getByText(fill(copy.deletedBy, { name: "Bob Smith", file: "results.tex" }))).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: fill(enCollab.deleted.restoreLabel, { name: "results.tex" }) }),
    );
    expect(mocks.collabTrashRestore).toHaveBeenCalledWith("paper", "results-id");
    await waitFor(() => expect(screen.queryByTestId("collab-removed-notice")).toBeNull());
  });

  it("tells the person when their offline changes went to Recently deleted", () => {
    render(<RemovedFileBanner />);
    show(notice({ path: "chapters/plan.tex", id: "plan-id", yours: true }));
    expect(screen.getByText(fill(copy.yoursDeleted, { name: "Bob Smith", file: "plan.tex" }))).toBeTruthy();
  });

  it("lets a viewer dismiss the notice but not restore the file", async () => {
    useCollabLiveStore.setState({ role: "viewer" });
    render(<RemovedFileBanner />);
    show(notice({ by: CAROL_ID }));
    expect(screen.getByText(fill(copy.deletedBy, { name: enCollab.toolbar.unknownPerson, file: "results.tex" }))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: copy.dismiss }));
    expect(screen.queryByTestId("collab-removed-notice")).toBeNull();
  });

  it("shows why a restore failed and keeps the notice", async () => {
    mocks.collabTrashRestore.mockRejectedValueOnce({ code: "forbidden", message: "viewers cannot restore" });
    render(<RemovedFileBanner />);
    show(notice());
    await userEvent.click(screen.getByRole("button", { name: fill(enCollab.deleted.restoreLabel, { name: "results.tex" }) }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByTestId("collab-removed-notice")).toBeTruthy();
  });

  it("shows the full path in the app tooltip and never in a native title", async () => {
    const user = userEvent.setup();
    const { container } = render(<RemovedFileBanner />);
    show(notice());
    const message = screen.getByText(fill(copy.deletedBy, { name: "Bob Smith", file: "results.tex" }));
    expect(container.querySelector("[title]")).toBeNull();
    await user.hover(message);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("sections/results.tex");
  });

  it("shows nothing for another project", () => {
    render(<RemovedFileBanner />);
    act(() => useRemovedNotices.setState({ projectId: "other", notices: [notice()] }));
    expect(screen.queryByTestId("collab-removed-notice")).toBeNull();
  });
});

// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { COLLAB_SERVER_CHANGED_EVENT } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCollabStore } from "../store";
import {
  CAROL,
  SERVER_ID,
  SHARED_ID,
  collabError,
  fill,
  projectSummary,
  server,
  sharedWithMe,
} from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabSharedWithMe: vi.fn(),
  collabJoinProject: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabSharedWithMe: mocks.collabSharedWithMe,
  collabJoinProject: mocks.collabJoinProject,
}));

import { SharedWithYou } from "./SharedWithYou";

const copy = enCollab.library.sharedWithYou;
const refreshProjects = vi.fn(async () => undefined);
const openProject = vi.fn(async () => undefined);
const thesis = sharedWithMe({
  project: projectSummary({ project_id: "shared-thesis", title: "Thesis", owner: CAROL, role: "viewer" }),
});

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {} });
  useFilesStore.setState({ refreshProjects, openProject });
});

describe("SharedWithYou", () => {
  it("lists projects others shared that are not on this computer yet, with owner, server and role", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([
      sharedWithMe(),
      thesis,
      sharedWithMe({ project: projectSummary({ project_id: "local", title: "Already here" }), local_project_id: "here" }),
    ]);
    render(<SharedWithYou />);
    const list = await screen.findByRole("list", { name: copy.title });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Grant proposal");
    expect(rows[0]).toHaveTextContent(fill(copy.from, { owner: "Bob Smith", server: "Smith Lab" }));
    expect(rows[0]).toHaveTextContent(enCollab.projectRoles.editor);
    expect(rows[1]).toHaveTextContent("Thesis");
    expect(rows[1]).toHaveTextContent(enCollab.projectRoles.viewer);
    expect(screen.queryByText("Already here")).toBeNull();
  });

  it("checks again when the window regains focus and on a timer, so new shares appear while the app is open", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<SharedWithYou />);
      await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(1));
      mocks.collabSharedWithMe.mockResolvedValue([sharedWithMe()]);
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(await screen.findByText("Grant proposal")).toBeInTheDocument();
      const calls = mocks.collabSharedWithMe.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(mocks.collabSharedWithMe.mock.calls.length).toBeGreaterThan(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("downloads and opens a project", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([sharedWithMe()]);
    mocks.collabJoinProject.mockResolvedValue("grant-local");
    const user = userEvent.setup();
    render(<SharedWithYou />);
    await user.click(await screen.findByRole("button", { name: fill(copy.openNamed, { name: "Grant proposal" }) }));
    expect(mocks.collabJoinProject).toHaveBeenCalledWith(SERVER_ID, SHARED_ID);
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("grant-local"));
    expect(refreshProjects).toHaveBeenCalled();
  });

  it("explains a failed open on that row", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([sharedWithMe()]);
    mocks.collabJoinProject.mockRejectedValue(collabError("forbidden"));
    const user = userEvent.setup();
    render(<SharedWithYou />);
    await user.click(await screen.findByRole("button", { name: fill(copy.openNamed, { name: "Grant proposal" }) }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(openProject).not.toHaveBeenCalled();
  });

  it("shows nothing when nothing is shared or the list cannot load", async () => {
    mocks.collabSharedWithMe.mockRejectedValue(collabError("unreachable"));
    const { container } = render(<SharedWithYou />);
    await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("refreshes when a server changes or the server list changes", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([]);
    render(<SharedWithYou />);
    await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listeners.has(COLLAB_SERVER_CHANGED_EVENT)).toBe(true));
    mocks.collabSharedWithMe.mockResolvedValue([sharedWithMe()]);
    act(() => mocks.listeners.get(COLLAB_SERVER_CHANGED_EVENT)?.({ payload: { serverId: SERVER_ID } }));
    expect(await screen.findByText("Grant proposal")).toBeInTheDocument();
    act(() => useCollabStore.setState({ servers: [server()] }));
    await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(3));
  });
});

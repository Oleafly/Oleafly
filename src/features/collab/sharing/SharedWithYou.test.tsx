// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { COLLAB_SERVER_CHANGED_EVENT } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCollabStore } from "../store";
import {
  CAROL,
  SERVER_ID,
  SHARED_ID,
  collabError,
  deferred,
  fill,
  projectSummary,
  server,
  sharedWithMe,
} from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabSharedWithMe: vi.fn(),
  collabJoinProject: vi.fn(),
  collabJoinCancel: vi.fn(),
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
  collabJoinCancel: mocks.collabJoinCancel,
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

  it("checks again when the window is shown and on a timer, so new shares appear while the app is open", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<SharedWithYou />);
      await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(1));
      mocks.collabSharedWithMe.mockResolvedValue([sharedWithMe()]);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
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

  it("doesn't check while the window is hidden, and catches up once it's shown", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([]);
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<SharedWithYou />);
      await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mocks.listeners.has(COLLAB_SERVER_CHANGED_EVENT)).toBe(true));
      visibility = "hidden";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        mocks.listeners.get(COLLAB_SERVER_CHANGED_EVENT)?.({ payload: { serverId: SERVER_ID } });
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });
      expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(1);
      visibility = "visible";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(document, "visibilityState");
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

  it("shows the download on that row and stops it with Cancel", async () => {
    const join = deferred<string>();
    mocks.collabSharedWithMe.mockResolvedValue([sharedWithMe(), thesis]);
    mocks.collabJoinProject.mockReturnValue(join.promise);
    mocks.collabJoinCancel.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SharedWithYou />);
    await user.click(await screen.findByRole("button", { name: fill(copy.openNamed, { name: "Grant proposal" }) }));
    const rows = within(screen.getByRole("list", { name: copy.title })).getAllByRole("listitem");
    const progress = within(rows[0]).getByTestId("collab-join-progress");
    expect(within(rows[1]).queryByTestId("collab-join-progress")).toBeNull();
    await waitFor(() => expect(mocks.listeners.has("collab-join-progress")).toBe(true));
    act(() =>
      mocks.listeners.get("collab-join-progress")?.({
        payload: { serverId: SERVER_ID, sharedProjectId: SHARED_ID, done: 1, total: 4 },
      }),
    );
    expect(progress).toHaveTextContent(fill(enCollab.links.downloading, { done: "1", total: "4" }));
    const cancel = within(progress).getByRole("button", { name: fill(enCollab.links.cancelNamed, { name: "Grant proposal" }) });
    expect(cancel.getAttribute("aria-label")).toContain(enCommon.actions.cancel);
    await user.click(cancel);
    expect(mocks.collabJoinCancel).toHaveBeenCalledWith(SERVER_ID, SHARED_ID);
    expect(within(progress).getByRole("status")).toHaveTextContent(enCollab.links.cancelling);
    await act(async () => join.reject(collabError("cancelled")));
    await waitFor(() => expect(screen.queryByTestId("collab-join-progress")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(openProject).not.toHaveBeenCalled();
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

  it("shows nothing when nothing is shared", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([]);
    const { container } = render(<SharedWithYou />);
    await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("explains a list that can't be checked and checks again on Retry", async () => {
    mocks.collabSharedWithMe.mockRejectedValueOnce(collabError("unreachable")).mockResolvedValue([sharedWithMe()]);
    const user = userEvent.setup();
    render(<SharedWithYou />);
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unreachable)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText("Grant proposal")).toBeInTheDocument();
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
  });

  it("keeps the projects it found when a later check fails", async () => {
    mocks.collabSharedWithMe.mockResolvedValueOnce([sharedWithMe()]).mockRejectedValue(collabError("unreachable"));
    render(<SharedWithYou />);
    expect(await screen.findByText("Grant proposal")).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Grant proposal")).toBeInTheDocument();
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
  });

  it("refreshes once after a burst of server changes, and when a server is added or signs in or out", async () => {
    mocks.collabSharedWithMe.mockResolvedValue([]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<SharedWithYou />);
      await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mocks.listeners.has(COLLAB_SERVER_CHANGED_EVENT)).toBe(true));
      mocks.collabSharedWithMe.mockResolvedValue([sharedWithMe()]);
      await act(async () => {
        for (let index = 0; index < 3; index += 1) {
          mocks.listeners.get(COLLAB_SERVER_CHANGED_EVENT)?.({ payload: { serverId: SERVER_ID } });
          await vi.advanceTimersByTimeAsync(200);
        }
      });
      expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(2);
      expect(await screen.findByText("Grant proposal")).toBeInTheDocument();

      act(() => useCollabStore.setState({ servers: [server()] }));
      await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(3));
      act(() => useCollabStore.setState({ servers: [server({ name: "Smith Lab renamed" })] }));
      act(() => useCollabStore.setState({ servers: [server({ name: "Smith Lab renamed" })] }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(3);
      act(() => useCollabStore.setState({ servers: [server({ signed_in: false, account: null })] }));
      await waitFor(() => expect(mocks.collabSharedWithMe).toHaveBeenCalledTimes(4));
    } finally {
      vi.useRealTimers();
    }
  });
});

// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  logError: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/overleaf-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-live")>()),
  overleafLiveRefreshLinked: mocks.refresh,
}));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: mocks.logError,
}));
vi.mock("@/lib/toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/toast")>();
  return { ...actual, toast: { ...actual.toast, error: mocks.toastError } };
});

import { useCollabEditorGate, useLiveBackend } from "@/lib/collab-live-bridge";
import type { OverleafLinkedFile } from "@/lib/overleaf-live";
import { activeFileReadOnly, readOnlyEditMessage, useActiveFileReadOnly } from "@/lib/read-only-files";
import { useFilesStore } from "@/store/files";
import { LinkedFileBanner } from "./LinkedFileBanner";
import { refreshLinked, useLinkedRefresh } from "./linked-refresh";
import { useCollabLiveStore } from "./live-store";
import { receiveOverleafTree } from "./overleaf-tree";

const copy = enCollab.overleafLinked;
const LINKED: OverleafLinkedFile = {
  path: "refs.bib",
  provider: "project_file",
  url: null,
  sourceProject: "64b7f0c2a1e3d4b5c6a7e8f9",
  sourcePath: "/shared/sample.bib",
};

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, value), template);
}

function linkedHere(files: OverleafLinkedFile[] = [LINKED]) {
  act(() => {
    useLiveBackend.setState({ projectId: "paper", backend: "overleaf", linked: files });
  });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ projectId: "paper", activePath: "refs.bib", manifestHome: "library", tree: [] });
  useCollabEditorGate.setState({ projectId: "paper", viewer: false, locked: false, connecting: false });
  useLinkedRefresh.setState({ projectId: null, refreshing: null, failure: null });
});

afterEach(() => {
  useLiveBackend.setState({ projectId: null, backend: null, linked: [] });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false });
  useCollabLiveStore.setState({ projectId: null, overleafLinked: [] });
});

describe("the linked file banner", () => {
  it("names the source and refreshes with a busy state", async () => {
    let finish: () => void = () => undefined;
    mocks.refresh.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    linkedHere();
    render(<LinkedFileBanner />);
    expect(screen.getByText(fill(copy.banner, { file: "refs.bib", source: "shared/sample.bib" }))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: copy.refresh }));
    expect(mocks.refresh).toHaveBeenCalledWith("paper", "refs.bib");
    const busy = await screen.findByRole("button", { name: copy.refreshing });
    expect(busy).toBeDisabled();
    act(() => finish());
    expect(await screen.findByRole("button", { name: copy.refresh })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows Overleaf's own words inline and logs the failure", async () => {
    mocks.refresh.mockRejectedValue({
      code: "linked_refresh_failed",
      message: "The project that contains this file is not shared with you",
    });
    linkedHere();
    render(<LinkedFileBanner />);
    await userEvent.click(screen.getByRole("button", { name: copy.refresh }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      fill(copy.refusedWith, { message: "The project that contains this file is not shared with you" }),
    );
    expect(mocks.logError).toHaveBeenCalledWith("refresh a linked file from Overleaf", expect.anything());
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("explains a server without linked files with the app's own words", async () => {
    mocks.refresh.mockRejectedValue({ code: "linked_off_server", message: "" });
    linkedHere([{ ...LINKED, sourcePath: null }]);
    render(<LinkedFileBanner />);
    expect(screen.getByText(fill(copy.bannerNoSource, { file: "refs.bib" }))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: copy.refresh }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.linked_off_server);
  });

  it("offers no refresh to reviewers and viewers", () => {
    useCollabEditorGate.setState({ locked: true });
    linkedHere();
    render(<LinkedFileBanner />);
    expect(screen.getByTestId("overleaf-linked-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.refresh })).toBeNull();
  });

  it("stays away from files that aren't linked", () => {
    useFilesStore.setState({ activePath: "main.tex" });
    linkedHere();
    const { container } = render(<LinkedFileBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tells about a failed refresh of a file that isn't open with a toast", async () => {
    useFilesStore.setState({ activePath: "main.tex" });
    mocks.refresh.mockRejectedValue({ code: "rate_limited", message: "" });
    expect(await refreshLinked("paper", "refs.bib")).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith(enCollab.errors.rate_limited);
    expect(await refreshLinked("paper", "refs.bib")).toBe(false);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
});

describe("linked files from the tree notice", () => {
  it("reach the store, the bridge and the read-only gate", async () => {
    useCollabLiveStore.setState({ projectId: "paper", backend: "overleaf", status: { state: "online" } });
    act(() => receiveOverleafTree({ projectId: "other", kind: "linked", files: [LINKED] }));
    expect(useCollabLiveStore.getState().overleafLinked).toEqual([]);
    act(() => receiveOverleafTree({ projectId: "paper", kind: "linked", files: [LINKED] }));
    expect(useCollabLiveStore.getState().overleafLinked).toEqual([LINKED]);
    linkedHere();
    expect(activeFileReadOnly()).toBe(true);
    expect(readOnlyEditMessage("refs.bib")).toBe(fill(copy.readOnly, { file: "refs.bib" }));
    expect(readOnlyEditMessage("main.tex")).toBeNull();
    const { result } = renderHook(() => useActiveFileReadOnly());
    expect(result.current).toBe(true);
    act(() => useLiveBackend.setState({ linked: [] }));
    await waitFor(() => expect(result.current).toBe(false));
    expect(activeFileReadOnly()).toBe(false);
  });
});

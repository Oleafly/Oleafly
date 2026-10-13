// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { fill } from "../tests/fixtures";
import { useCollabLiveStore } from "./live-store";

const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

vi.mock("sonner", () => ({ toast: toasts.toast }));

import { AccessChangeBanner } from "./AccessChangeBanner";
import { useSyncPauseStore } from "./sync-pause";
import { CollabBanners } from "./SyncPauseBanner";

const copy = enCollab.access;

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  useFilesStore.setState({ projectId: "paper" });
  useCollabLiveStore.setState({ projectId: "paper", accessNotice: null });
});

afterEach(() => {
  useCollabLiveStore.setState({ projectId: null, accessNotice: null });
  useFilesStore.setState({ projectId: null });
});

describe("AccessChangeBanner", () => {
  it("shows nothing while access is unchanged", () => {
    const { container } = render(<AccessChangeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says who made the person a viewer, inline and without a toast", () => {
    useCollabLiveStore.setState({ accessNotice: { kind: "viewer", byName: "Bob Smith" } });
    render(<AccessChangeBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(fill(copy.viewerBy, { name: "Bob Smith" }));
    expect(banner.querySelector("svg.lucide-eye")).toBeInTheDocument();
    expect(toasts.toast).not.toHaveBeenCalled();
    expect(toasts.toast.info).not.toHaveBeenCalled();
  });

  it("says who removed the person and that their copy stays on this computer", () => {
    useCollabLiveStore.setState({ accessNotice: { kind: "removed", byName: "Bob Smith" } });
    render(<AccessChangeBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(fill(copy.removedBy, { name: "Bob Smith" }));
  });

  it("leaves the name out when nobody is known to have made the change", () => {
    useCollabLiveStore.setState({ accessNotice: { kind: "viewer", byName: "" } });
    const view = render(<AccessChangeBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.viewer);
    act(() => useCollabLiveStore.setState({ accessNotice: { kind: "removed", byName: "" } }));
    expect(screen.getByRole("status")).toHaveTextContent(copy.removed);
    view.unmount();
  });

  it("goes away for good when closed", async () => {
    useCollabLiveStore.setState({ accessNotice: { kind: "viewer", byName: "Bob Smith" } });
    const user = userEvent.setup();
    render(<AccessChangeBanner />);
    await user.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(useCollabLiveStore.getState().accessNotice).toBeNull();
  });

  it("sits above the paused sync banner among the collaboration banners", () => {
    useCollabLiveStore.setState({ accessNotice: { kind: "removed", byName: "Bob Smith" } });
    useSyncPauseStore.setState({ waiting: { paper: 3 }, unavailable: {}, deciding: null });
    try {
      render(<CollabBanners />);
      const access = screen.getByTestId("collab-access-banner");
      const paused = screen.getByTestId("collab-sync-pause-banner");
      expect(access.compareDocumentPosition(paused) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      useSyncPauseStore.setState({ waiting: {}, unavailable: {}, deciding: null });
    }
  });

  it("does not show a notice that belongs to another project", () => {
    useCollabLiveStore.setState({ projectId: "other", accessNotice: { kind: "viewer", byName: "Bob Smith" } });
    const { container } = render(<AccessChangeBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});

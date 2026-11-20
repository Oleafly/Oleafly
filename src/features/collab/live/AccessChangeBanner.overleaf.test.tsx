// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/system-browser", () => ({ openInSystemBrowser: vi.fn(async () => true) }));

import { openInSystemBrowser } from "@/lib/system-browser";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { installOverleafLiveActions } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "./live-store";
import { CollabBanners } from "./SyncPauseBanner";

const copy = enCollab.access;
const LINK = { server: "https://www.overleaf.com", remoteId: "6af963ebc9037022065bb53f", signedIn: true, paused: false };
const unlink = vi.fn(async (_projectId: string) => {});
let uninstall: () => void = () => {};

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  unlink.mockReset();
  uninstall = installOverleafLiveActions({
    pause: async () => ({ paused: true, unsent: [] }),
    resume: async () => {},
    unlink,
  });
  useFilesStore.setState({ projectId: "paper" });
  useCollabLiveStore.setState({
    projectId: "paper",
    backend: "overleaf",
    overleaf: LINK,
    role: "editor",
    tracking: false,
    deletedExternally: false,
    status: { state: "online" },
    ended: null,
    accessNotice: null,
  });
});

afterEach(() => {
  uninstall();
  useCollabLiveStore.setState({
    projectId: null,
    backend: null,
    overleaf: null,
    role: null,
    tracking: false,
    deletedExternally: false,
    status: null,
    ended: null,
    accessNotice: null,
  });
  useFilesStore.setState({ projectId: null });
});

describe("access banners on Overleaf", () => {
  it("shows nothing for an editor whose edits go straight in", () => {
    const { container } = render(<CollabBanners />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tells a viewer they can only read, and opens the project on Overleaf to ask for more", async () => {
    useCollabLiveStore.setState({ role: "viewer" });
    const user = userEvent.setup();
    render(<CollabBanners />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.viewOnly);
    await user.click(screen.getByRole("button", { name: copy.askOnOverleaf }));
    expect(openInSystemBrowser).toHaveBeenCalledWith(`${LINK.server}/project/${LINK.remoteId}`);
  });

  it("says a reviewer's edits go in as suggestions", () => {
    useCollabLiveStore.setState({ role: "reviewer", tracking: true });
    render(<CollabBanners />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.reviewing);
  });

  it("follows track changes turning on and off for an editor", () => {
    render(<CollabBanners />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => useCollabLiveStore.setState({ tracking: true }));
    expect(screen.getByRole("status")).toHaveTextContent(copy.trackingChanges);
    act(() => useCollabLiveStore.setState({ tracking: false }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says when the project left the service it was linked to, while live editing goes on", () => {
    useCollabLiveStore.setState({ deletedExternally: true });
    render(<CollabBanners />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.deletedExternally);
    expect(screen.queryByRole("button", { name: copy.keepLocal })).toBeNull();
  });

  it("shows a role change once, then the lasting banner after it is closed", async () => {
    useCollabLiveStore.setState({ role: "viewer", accessNotice: { kind: "viewer", byName: "" } });
    const user = userEvent.setup();
    render(<CollabBanners />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(copy.viewer);
    await user.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(screen.getByRole("status")).toHaveTextContent(copy.viewOnly);
    await user.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["removed", copy.removedOverleaf, "svg.lucide-user-x"],
    ["project_deleted", copy.projectDeleted, "svg.lucide-ban"],
  ] as const)("when live ends as %s, offers to keep the project local", async (reason, text, icon) => {
    useCollabLiveStore.setState({
      status: { state: "ended", reason },
      ended: reason,
      accessNotice: reason === "removed" ? { kind: "removed", byName: "" } : null,
    });
    const user = userEvent.setup();
    render(<CollabBanners />);
    const banner = screen.getByRole("status");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(banner).toHaveTextContent(text);
    expect(banner).not.toHaveTextContent(copy.removed);
    expect(banner.querySelector(icon)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.keepLocal }));
    expect(unlink).toHaveBeenCalledWith("paper");
  });

  it("says the project couldn't go local when live editing isn't running", async () => {
    uninstall();
    useCollabLiveStore.setState({ status: { state: "ended", reason: "removed" }, ended: "removed" });
    const user = userEvent.setup();
    render(<CollabBanners />);
    await user.click(screen.getByRole("button", { name: copy.keepLocal }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.keepLocalFailed);
  });

  it("explains why the project couldn't go local, and hides once it is unlinked", async () => {
    unlink.mockRejectedValueOnce({ code: "overleaf_unsent", message: "unsent" });
    useCollabLiveStore.setState({ status: { state: "ended", reason: "project_deleted" }, ended: "project_deleted" });
    const user = userEvent.setup();
    render(<CollabBanners />);
    await user.click(screen.getByRole("button", { name: copy.keepLocal }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.keepLocalFailed);
    act(() => useCollabLiveStore.setState({ overleaf: null }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

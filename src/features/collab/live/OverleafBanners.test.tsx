// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { overleafLiveResolve } from "@/lib/overleaf-live";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "./live-store";
import { OverleafBanners } from "./OverleafBanners";
import { useOverleafNotices } from "./overleaf-notices";

const removal = vi.hoisted(() => ({
  overleafLiveProject: vi.fn(),
  recycleProject: vi.fn(async () => undefined),
  closeProject: vi.fn<() => Promise<void>>(),
  refreshProjects: vi.fn(async () => undefined),
}));

vi.mock("@/lib/overleaf-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-live")>()),
  overleafLiveResolve: vi.fn(async () => undefined),
  overleafLiveProject: removal.overleafLiveProject,
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  recycleProject: removal.recycleProject,
}));
vi.mock("@/store/files", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/store/files")>();
  const real = original.useFilesStore.getState;
  const getState = () => ({
    ...real(),
    closeProject: removal.closeProject,
    refreshProjects: removal.refreshProjects,
  });
  return { ...original, useFilesStore: Object.assign(original.useFilesStore, { getState }) };
});

const banners = enCollab.overleafBanners;
const REVIEW = { path: "main.tex", mine: "Hello there", theirs: "Hello world" };

function notices(change: Partial<ReturnType<typeof useOverleafNotices.getState>>) {
  useOverleafNotices.setState({
    projectId: "p1",
    maintenance: null,
    merged: [],
    reviews: [],
    unsteady: [],
    slowAck: false,
    resolving: null,
    failed: null,
    ...change,
  });
}

const LINK = { server: "https://latex.uni.edu", remoteId: "6af963ebc9037022065bb53f", signedIn: false, paused: false };
const TYPED_AS = { userId: "u-ada", email: "ada@uni.edu" };

function kept(path: string, copy: string) {
  return { id: path, path, copy, kind: "beside" as const, by: TYPED_AS.email };
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  removal.recycleProject.mockClear();
  removal.closeProject.mockReset().mockImplementation(async () => useFilesStore.setState({ projectId: null }));
  useFilesStore.setState({ projectId: "p1" });
});

afterEach(() => {
  useCollabLiveStore.setState({ status: null, overleaf: null, accountChanged: null });
  notices({ projectId: null });
  useFilesStore.setState({ projectId: null });
  vi.restoreAllMocks();
});

describe("OverleafBanners", () => {
  it("says the session is signed out and opens the sign-in settings", async () => {
    const openSettingsAt = vi.spyOn(useSettingsStore.getState(), "openSettingsAt").mockImplementation(() => {});
    useCollabLiveStore.setState({ status: { state: "signed_out" }, overleaf: LINK });
    render(<OverleafBanners />);
    const banner = screen.getByTestId("overleaf-signed-out-banner");
    expect(banner).toHaveTextContent(
      "You're signed out of latex.uni.edu, so this project isn't syncing. You can keep typing.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(openSettingsAt).toHaveBeenCalledWith("integrations");
  });

  it("names the account the project belongs to when that account is signed out", async () => {
    const openSettingsAt = vi.spyOn(useSettingsStore.getState(), "openSettingsAt").mockImplementation(() => {});
    useCollabLiveStore.setState({
      status: { state: "signed_out" },
      overleaf: { ...LINK, signedIn: false, account: { userId: "u-bea", email: "bea@lab.org" } },
    });
    render(<OverleafBanners />);
    expect(screen.getByTestId("overleaf-signed-out-banner")).toHaveTextContent(
      "This project belongs to bea@lab.org on latex.uni.edu. That account isn't signed in",
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign in as bea@lab.org" }));
    expect(openSettingsAt).toHaveBeenCalledWith("integrations");
  });

  it("shows nothing while the session is online", () => {
    useCollabLiveStore.setState({ status: { state: "online" }, overleaf: LINK });
    render(<OverleafBanners />);
    expect(screen.queryByTestId("overleaf-signed-out-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overleaf-account-changed-banner")).not.toBeInTheDocument();
  });

  it("names the one copy kept after an account switch and goes away when dismissed", async () => {
    const copy = "main (from ada@uni.edu).tex";
    useCollabLiveStore.setState({
      accountChanged: { projectId: "p1", typedAs: TYPED_AS, files: [kept("main.tex", copy)] },
    });
    render(<OverleafBanners />);
    const banner = screen.getByTestId("overleaf-account-changed-banner");
    expect(banner).toHaveTextContent(
      `the changes you made as ada@uni.edu weren't sent. They're kept as ${copy}.`,
    );
    expect(banner.querySelector("ul")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("overleaf-account-changed-banner")).not.toBeInTheDocument();
  });

  it("lists every copy when several files were kept", () => {
    useCollabLiveStore.setState({
      accountChanged: {
        projectId: "p1",
        typedAs: TYPED_AS,
        files: [kept("main.tex", "main (from ada@uni.edu).tex"), kept("intro.tex", "intro (from ada@uni.edu).tex")],
      },
    });
    render(<OverleafBanners />);
    const banner = screen.getByTestId("overleaf-account-changed-banner");
    expect(banner).toHaveTextContent("They're kept as copies next to their files:");
    expect(banner).toHaveTextContent("main.tex is kept as main (from ada@uni.edu).tex");
    expect(banner).toHaveTextContent("intro.tex is kept as intro (from ada@uni.edu).tex");
  });

  it("stays quiet after an account switch that kept nothing", () => {
    useCollabLiveStore.setState({ accountChanged: { projectId: "p1", typedAs: TYPED_AS, files: [] } });
    render(<OverleafBanners />);
    expect(screen.queryByTestId("overleaf-account-changed-banner")).not.toBeInTheDocument();
  });

  it("shows the server's maintenance message as plain text, without its markup, with a countdown", () => {
    notices({ maintenance: { message: "Back <b>soon</b> &amp; faster", until: Date.now() + 30_000 } });
    render(<OverleafBanners />);
    const banner = screen.getByTestId("overleaf-maintenance-banner");
    expect(banner).toHaveTextContent("Overleaf says: Back soon & faster");
    expect(banner).toHaveTextContent(banners.maintenanceWait.replace("{{seconds}}", "30"));
    expect(banner.querySelector("b")).toBeNull();
  });

  it("runs no countdown timer without a maintenance message", () => {
    const ticking = vi.spyOn(window, "setInterval");
    notices({ merged: [{ path: "main.tex", before: "a", after: "ab" }] });
    render(<OverleafBanners />);
    expect(ticking.mock.calls.filter(([, every]) => every === 1_000)).toHaveLength(0);
    ticking.mockRestore();
  });

  it("needs_review actions settle the doc either way, with Use mine only after comparing", async () => {
    notices({ reviews: [REVIEW, { ...REVIEW, path: "intro.tex" }] });
    render(<OverleafBanners />);
    const row = screen.getByTestId("overleaf-review-row");
    expect(row).toHaveTextContent(banners.review.replace("{{path}}", "main.tex and intro.tex"));
    expect(within(row).queryByRole("button", { name: banners.useMine })).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: enCommon.actions.showMore }));
    const [first, second] = screen.getAllByTestId("overleaf-review-row-item");
    expect(first).toHaveTextContent("main.tex");
    expect(second).toHaveTextContent("intro.tex");
    await userEvent.click(within(first).getByRole("button", { name: banners.compare }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: banners.useMine }));
    expect(overleafLiveResolve).toHaveBeenCalledWith("p1", "main.tex", "mine");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const left = screen.getByTestId("overleaf-review-row");
    expect(left).toHaveTextContent(banners.review.replace("{{path}}", "intro.tex"));
    await userEvent.click(within(left).getByRole("button", { name: banners.useTheirs }));
    expect(overleafLiveResolve).toHaveBeenCalledWith("p1", "intro.tex", "theirs");
    expect(screen.queryAllByTestId("overleaf-review-row")).toHaveLength(0);
  });

  it("says under the message when a choice could not be applied", async () => {
    vi.mocked(overleafLiveResolve).mockRejectedValueOnce(new Error("refused"));
    notices({ reviews: [REVIEW] });
    render(<OverleafBanners />);
    const row = screen.getByTestId("overleaf-review-row");
    expect(within(row).queryByRole("button", { name: banners.useMine })).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: banners.useTheirs }));
    const alert = await within(row).findByRole("alert");
    expect(alert).toHaveTextContent(banners.resolveFailed);
    expect(alert.parentElement).toHaveTextContent(banners.review.replace("{{path}}", "main.tex"));
  });

  it("keeps the comparison open and says so when a choice could not be applied", async () => {
    vi.mocked(overleafLiveResolve).mockRejectedValueOnce(new Error("refused"));
    notices({ reviews: [REVIEW] });
    render(<OverleafBanners />);
    await userEvent.click(screen.getByRole("button", { name: banners.compare }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: banners.useMine }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(banners.resolveFailed);
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("puts many merged files on one row and lists them when asked", async () => {
    const paths = ["a.tex", "b.tex", "c.tex", "d.tex", "e.tex"];
    notices({ merged: paths.map((path) => ({ path, before: "x", after: "xy" })) });
    render(<OverleafBanners />);
    const rows = screen.getAllByTestId("overleaf-merged-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(banners.merged.replace("{{path}}", "a.tex, b.tex, c.tex and 2 more"));
    expect(screen.queryAllByTestId("overleaf-merged-row-item")).toHaveLength(0);
    await userEvent.click(within(rows[0]).getByRole("button", { name: enCommon.actions.showMore }));
    expect(screen.getAllByTestId("overleaf-merged-row-item")).toHaveLength(5);
    await userEvent.click(within(rows[0]).getByRole("button", { name: enCommon.actions.showLess }));
    await userEvent.click(within(rows[0]).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("overleaf-merged-row")).toBeNull();
  });

  it("compares both copies before choosing", async () => {
    notices({ reviews: [REVIEW] });
    render(<OverleafBanners />);
    await userEvent.click(screen.getByRole("button", { name: banners.compare }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(banners.reviewTitle.replace("{{path}}", "main.tex"));
    await userEvent.click(within(dialog).getByRole("button", { name: banners.useTheirs }));
    expect(overleafLiveResolve).toHaveBeenCalledWith("p1", "main.tex", "theirs");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("lists a merge with its changes and lets it go", async () => {
    notices({ merged: [{ path: "main.tex", before: "Oh, Hello", after: "Oh, Hello world" }] });
    render(<OverleafBanners />);
    const row = screen.getByTestId("overleaf-merged-row");
    expect(row).toHaveTextContent(banners.merged.replace("{{path}}", "main.tex"));
    await userEvent.click(within(row).getByRole("button", { name: banners.showChanges }));
    expect(screen.getByRole("dialog")).toHaveTextContent(banners.mergedTitle.replace("{{path}}", "main.tex"));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(row).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("overleaf-merged-row")).toBeNull();
  });

  it("says which settings didn't reach Overleaf and why", async () => {
    notices({
      settings: [
        { setting: "compiler", reason: "no_equivalent" },
        { setting: "main_doc", reason: "conflict" },
      ],
    });
    render(<OverleafBanners />);
    const banner = screen.getByTestId("overleaf-settings-banner");
    expect(banner).toHaveTextContent(
      banners.settingNotSent.no_equivalent.replaceAll("{{setting}}", banners.settingNames.compiler),
    );
    expect(banner).toHaveTextContent(
      banners.settingNotSent.conflict.replace("{{setting}}", banners.settingNames.main_doc),
    );
    await userEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("overleaf-settings-banner")).toBeNull();
  });

  it("says when someone else's edits keep closing a doc", async () => {
    notices({ unsteady: ["main.tex"] });
    render(<OverleafBanners />);
    expect(screen.getByTestId("overleaf-unsteady-row")).toHaveTextContent(banners.unsteady.replace("{{path}}", "main.tex"));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("overleaf-unsteady-row")).toBeNull();
  });

  it("shows how far an open from Overleaf has come", () => {
    notices({ filling: { done: 3, total: 8 } });
    const { rerender } = render(<OverleafBanners />);
    expect(screen.getByTestId("overleaf-filling-banner")).toHaveTextContent(
      "Opening the project from Overleaf: 3 of 8 files",
    );
    notices({ filling: { done: 8, total: 8 } });
    rerender(<OverleafBanners />);
    expect(screen.getByTestId("overleaf-filling-banner")).toHaveTextContent("downloading the last files");
    notices({ filling: null });
    rerender(<OverleafBanners />);
    expect(screen.queryByTestId("overleaf-filling-banner")).toBeNull();
  });

  it("offers to remove a copy that never got a file once the project is gone from Overleaf", async () => {
    removal.overleafLiveProject.mockResolvedValue({ ...LINK, unfilled: true });
    useCollabLiveStore.setState({
      projectId: "p1",
      status: { state: "ended", reason: "project_deleted" },
      overleaf: { ...LINK, unfilled: true },
    });
    render(<OverleafBanners />);
    const banner = await screen.findByTestId("overleaf-empty-copy-banner");
    expect(banner).toHaveTextContent(banners.emptyCopy);
    expect(removal.recycleProject).not.toHaveBeenCalled();
    await userEvent.setup().click(within(banner).getByRole("button", { name: banners.removeEmptyCopy }));
    await waitFor(() => expect(removal.recycleProject).toHaveBeenCalledWith("p1"));
    expect(removal.closeProject).toHaveBeenCalled();
  });

  it("removes the empty copy without closing a project opened in the meantime", async () => {
    removal.overleafLiveProject.mockResolvedValue({ ...LINK, unfilled: true });
    useCollabLiveStore.setState({ projectId: "p1", status: { state: "ended", reason: "project_deleted" }, overleaf: LINK });
    render(<OverleafBanners />);
    const banner = await screen.findByTestId("overleaf-empty-copy-banner");
    let answer: (project: unknown) => void = () => {};
    removal.overleafLiveProject.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await userEvent.setup().click(within(banner).getByRole("button", { name: banners.removeEmptyCopy }));
    useFilesStore.setState({ projectId: "p2" });
    answer({ ...LINK, unfilled: true });
    await waitFor(() => expect(removal.recycleProject).toHaveBeenCalledWith("p1"));
    expect(removal.closeProject).not.toHaveBeenCalled();
  });

  it("keeps the empty copy when the project couldn't be closed", async () => {
    removal.overleafLiveProject.mockResolvedValue({ ...LINK, unfilled: true });
    removal.closeProject.mockImplementationOnce(async () => undefined);
    useCollabLiveStore.setState({ projectId: "p1", status: { state: "ended", reason: "project_deleted" }, overleaf: LINK });
    render(<OverleafBanners />);
    const banner = await screen.findByTestId("overleaf-empty-copy-banner");
    await userEvent.setup().click(within(banner).getByRole("button", { name: banners.removeEmptyCopy }));
    await waitFor(() => expect(removal.closeProject).toHaveBeenCalled());
    await waitFor(() => expect(within(banner).getByRole("button", { name: banners.removeEmptyCopy })).toBeEnabled());
    expect(removal.recycleProject).not.toHaveBeenCalled();
  });

  it("never offers to remove a copy that has files or a project that is still there", async () => {
    removal.overleafLiveProject.mockResolvedValue({ ...LINK, unfilled: false });
    useCollabLiveStore.setState({ projectId: "p1", status: { state: "ended", reason: "access_ended" }, overleaf: LINK });
    render(<OverleafBanners />);
    await waitFor(() => expect(removal.overleafLiveProject).toHaveBeenCalledWith("p1"));
    expect(screen.queryByTestId("overleaf-empty-copy-banner")).toBeNull();
    removal.overleafLiveProject.mockClear();
    useCollabLiveStore.setState({ status: { state: "online" } });
    expect(removal.overleafLiveProject).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { overleafLiveResolve } from "@/lib/overleaf-live";
import { useCollabLiveStore } from "./live-store";
import { OverleafBanners } from "./OverleafBanners";
import { useOverleafNotices } from "./overleaf-notices";

vi.mock("@/lib/overleaf-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-live")>()),
  overleafLiveResolve: vi.fn(async () => undefined),
}));

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

afterEach(() => {
  useCollabLiveStore.setState({ status: null, overleaf: null, accountChanged: null });
  notices({ projectId: null });
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

  it("says when someone else's edits keep closing a doc", async () => {
    notices({ unsteady: ["main.tex"] });
    render(<OverleafBanners />);
    expect(screen.getByTestId("overleaf-unsteady-row")).toHaveTextContent(banners.unsteady.replace("{{path}}", "main.tex"));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("overleaf-unsteady-row")).toBeNull();
  });
});

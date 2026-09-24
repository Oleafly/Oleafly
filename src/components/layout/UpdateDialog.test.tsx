// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UpdateDialog, type UpdateDialogProps, type UpdateHistoryView } from "./UpdateDialog";
import { parseReleaseDate, relativeTimeLabel, splitNotesTitle } from "./ReleaseTimeline";
import { loadReleaseNotesRenderer } from "./ReleaseNotes";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const NOW = Date.parse("2026-09-24T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => loadReleaseNotesRenderer());
afterEach(cleanup);

function props(overrides: Partial<UpdateDialogProps> = {}): UpdateDialogProps {
  return {
    phase: "available",
    nextVersion: "0.4.3",
    currentVersion: "0.4.1",
    releaseDate: new Date(NOW - DAY).toISOString(),
    notes: "## What's new in 0.4.3\n\n### Fixed\n\n- The update window lists every release you skipped.",
    percent: 0,
    errorMessage: "",
    selfInstallable: true,
    installedVersion: "0.4.1",
    onClose: vi.fn(),
    onInstall: vi.fn(),
    onRetry: vi.fn(),
    onOpenRelease: vi.fn(),
    onOpenLink: vi.fn(),
    now: () => NOW,
    ...overrides,
  };
}

function history(overrides: Partial<UpdateHistoryView> = {}): UpdateHistoryView {
  return { entries: [], status: "idle", onLoadMore: vi.fn(), onRetry: vi.fn(), ...overrides };
}

describe("release date helpers", () => {
  it("describes how long ago a release was published", () => {
    expect(relativeTimeLabel(new Date(NOW - 20 * 1000), NOW, "en")).toBe("now");
    expect(relativeTimeLabel(new Date(NOW - 5 * 60 * 1000), NOW, "en")).toBe("5 minutes ago");
    expect(relativeTimeLabel(new Date(NOW - 3 * 60 * 60 * 1000), NOW, "en")).toBe("3 hours ago");
    expect(relativeTimeLabel(new Date(NOW - DAY), NOW, "en")).toBe("yesterday");
    expect(relativeTimeLabel(new Date(NOW - 3 * DAY), NOW, "en")).toBe("3 days ago");
    expect(relativeTimeLabel(new Date(NOW - 14 * DAY), NOW, "en")).toBe("2 weeks ago");
    expect(relativeTimeLabel(new Date(NOW - 40 * DAY), NOW, "en")).toBe("last month");
    expect(relativeTimeLabel(new Date(NOW - 400 * DAY), NOW, "en")).toBe("last year");
    expect(relativeTimeLabel(new Date(NOW - DAY), NOW, "de")).toBe("gestern");
  });

  it("parses the updater's date formats and rejects garbage", () => {
    expect(parseReleaseDate("2026-09-21T07:47:46Z")?.toISOString()).toBe("2026-09-21T07:47:46.000Z");
    expect(parseReleaseDate("2026-09-21 7:47:46.0 +00:00:00")?.toISOString()).toBe("2026-09-21T07:47:46.000Z");
    expect(parseReleaseDate("soon")).toBeNull();
    expect(parseReleaseDate(undefined)).toBeNull();
  });

  it("splits a leading notes title from the body", () => {
    expect(splitNotesTitle("## What's new in 0.4.3\n\n### Fixed\n- x")).toEqual({
      title: "What's new in 0.4.3",
      body: "### Fixed\n- x",
    });
    expect(splitNotesTitle("### Fixed\n- x")).toEqual({ title: null, body: "### Fixed\n- x" });
    expect(splitNotesTitle("## Release 1.0 ##\r\nBody")).toEqual({ title: "Release 1.0", body: "Body" });
    expect(splitNotesTitle("# C# support\n\nBody")).toEqual({ title: "C# support", body: "Body" });
    expect(splitNotesTitle("## Works in C#")).toEqual({ title: "Works in C#", body: "" });
    expect(splitNotesTitle("##No space\nBody")).toEqual({ title: null, body: "##No space\nBody" });
    expect(splitNotesTitle(`## ${" ".repeat(50_000)}x`)).toEqual({ title: "x", body: "" });
  });
});

describe("UpdateDialog", () => {
  it("puts the version in one header tag and says when it was released", () => {
    const onOpenRelease = vi.fn();
    render(<UpdateDialog {...props({ onOpenRelease })} />);
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { name: enShell.updateWindow.available })).toBeInTheDocument();
    expect(within(header).getByText("You're on v0.4.1")).toBeInTheDocument();
    expect(within(header).getByText("Released yesterday")).toBeInTheDocument();
    fireEvent.click(within(header).getByRole("button", { name: /v0\.4\.3/ }));
    expect(onOpenRelease).toHaveBeenCalledOnce();
    expect(screen.getAllByText("v0.4.3")).toHaveLength(1);
    expect(screen.queryByText("What's new in 0.4.3")).not.toBeInTheDocument();
    expect(screen.getByText("The update window lists every release you skipped.")).toBeInTheDocument();
  });

  it("lists skipped releases on the timeline, ends at the installed version, and opens each release", () => {
    const onOpenLink = vi.fn();
    render(
      <UpdateDialog
        {...props({ onOpenLink })}
        history={history({
          status: "done",
          entries: [
            {
              version: "0.4.2",
              publishedAt: new Date(NOW - 14 * DAY).toISOString(),
              body: "## What's new in 0.4.2\n\n### Added\n\n- Source Control.",
              url: "https://github.com/Oleafly/Oleafly/releases/tag/v0.4.2",
            },
          ],
        })}
      />,
    );
    const items = screen.getAllByTestId("release-timeline-item");
    expect(items.map((item) => item.dataset.version)).toEqual(["0.4.3", "0.4.2"]);
    expect(within(items[1]).getByText("v0.4.2")).toBeInTheDocument();
    expect(within(items[1]).getByText("2 weeks ago")).toBeInTheDocument();
    fireEvent.click(within(items[1]).getByRole("button", { name: enShell.updateWindow.viewRelease }));
    expect(onOpenLink).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly/releases/tag/v0.4.2");
    expect(screen.getByTestId("release-history-end")).toHaveTextContent("You're on v0.4.1");
  });

  it("asks for the next release only while the history is idle", () => {
    const idle = history();
    const { rerender } = render(<UpdateDialog {...props()} history={idle} />);
    expect(idle.onLoadMore).toHaveBeenCalled();
    const loading = history({ status: "loading" });
    rerender(<UpdateDialog {...props()} history={loading} />);
    expect(loading.onLoadMore).not.toHaveBeenCalled();
  });

  it("offers a retry when earlier notes fail to load", () => {
    const failed = history({ status: "error" });
    render(<UpdateDialog {...props()} history={failed} />);
    expect(screen.getByText(enShell.updateWindow.historyFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(failed.onRetry).toHaveBeenCalledOnce();
  });

  it("shows a failed install above the notes with every way forward", () => {
    const onRetry = vi.fn();
    render(<UpdateDialog {...props({ phase: "error", errorMessage: "Error: disk full", onRetry })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(enShell.updateWindow.error);
    expect(screen.getByTestId("update-error-details")).toHaveTextContent("Error: disk full");
    fireEvent.click(screen.getByRole("button", { name: enShell.updateChecker.tryAgain }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: enShell.updateChecker.downloadFromGithub })).toBeInTheDocument();
    expect(screen.getByTestId("release-timeline")).toBeInTheDocument();
  });

  it("hides close while downloading and tints the progress bar with the primary colour", () => {
    render(<UpdateDialog {...props({ phase: "downloading", percent: 42 })} />);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar.firstElementChild).toHaveClass("bg-primary");
    expect(screen.getByText("Downloading… 42%")).toBeInTheDocument();
  });

  it("says once that the app is up to date", () => {
    render(<UpdateDialog {...props({ phase: "upToDate", nextVersion: undefined, installedVersion: "0.4.3" })} />);
    expect(screen.getAllByText(enShell.updateWindow.upToDate)).toHaveLength(1);
    expect(screen.getByText("Oleafly v0.4.3 is the latest version")).toBeInTheDocument();
    expect(screen.queryByText(enShell.updateWindow.upToDateHeadline)).not.toBeInTheDocument();
  });

  it("names the failed check when there is no update to show", () => {
    render(<UpdateDialog {...props({ phase: "error", nextVersion: undefined, errorMessage: "offline" })} />);
    expect(screen.getByRole("heading", { name: enShell.updateChecker.checkFailed })).toBeInTheDocument();
    expect(screen.queryByTestId("release-timeline")).not.toBeInTheDocument();
  });
});

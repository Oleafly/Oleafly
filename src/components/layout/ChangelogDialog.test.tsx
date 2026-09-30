// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChangelogView } from "./ChangelogDialog";
import { loadReleaseNotesRenderer } from "./ReleaseNotes";
import type { ReleaseHistoryView } from "./ReleaseTimeline";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

const NOW = Date.parse("2026-09-24T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

afterEach(cleanup);

function release(version: string, daysAgo: number) {
  return {
    version,
    publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    body: `## What's new in ${version}\n\n### Fixed\n\n- Fix shipped in ${version}.`,
    url: `https://github.com/Oleafly/Oleafly/releases/tag/v${version}`,
  };
}

function history(overrides: Partial<ReleaseHistoryView> = {}): ReleaseHistoryView {
  return {
    entries: [release("0.4.3", 1), release("0.4.2", 4), release("0.4.1", 12)],
    status: "idle",
    onLoadMore: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}

function renderView(installedVersion: string, overrides: Partial<ReleaseHistoryView> = {}) {
  const handlers = { onOpenLink: vi.fn(), onUpdate: vi.fn(), onClose: vi.fn() };
  render(
    <ChangelogView
      installedVersion={installedVersion}
      history={history(overrides)}
      now={() => NOW}
      {...handlers}
    />,
  );
  return handlers;
}

describe("ChangelogView", () => {
  it("says the installed version is up to date and marks it on the timeline", () => {
    renderView("0.4.3");
    const status = screen.getByTestId("changelog-status");
    expect(status).toHaveTextContent("You're on v0.4.3");
    expect(status).toHaveTextContent(enShell.updateWindow.upToDate);
    expect(screen.queryByRole("button", { name: enShell.updateChecker.updateNow })).not.toBeInTheDocument();
    const mine = screen.getByTestId("installed-release").closest("li");
    expect(mine?.dataset.version).toBe("0.4.3");
    expect(screen.getAllByTestId("installed-release")).toHaveLength(1);
  });

  it("names the newer version and offers the update when the installed one is behind", () => {
    const { onUpdate } = renderView("0.4.2");
    const status = screen.getByTestId("changelog-status");
    expect(status).toHaveTextContent(enShell.updateWindow.available);
    expect(within(status).getByText("v0.4.3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enShell.updateChecker.updateNow }));
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(screen.getByTestId("installed-release").closest("li")?.dataset.version).toBe("0.4.2");
  });

  it("lists every release newest first with its own date and link", () => {
    const { onOpenLink } = renderView("0.4.3");
    const items = screen.getAllByTestId("release-timeline-item");
    expect(items.map((item) => item.dataset.version)).toEqual(["0.4.3", "0.4.2", "0.4.1"]);
    expect(within(items[2]).getByText("2 weeks ago")).toBeInTheDocument();
    fireEvent.click(within(items[2]).getByRole("button", { name: enShell.updateWindow.viewRelease }));
    expect(onOpenLink).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly/releases/tag/v0.4.1");
    expect(screen.queryByTestId("release-history-end")).not.toBeInTheDocument();
  });

  it("keeps asking for older releases while idle and offers a retry after a failure", () => {
    const idle = history({ entries: [] });
    render(<ChangelogView installedVersion="0.4.3" history={idle} now={() => NOW} onOpenLink={vi.fn()} onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(idle.onLoadMore).toHaveBeenCalled();
    cleanup();
    const failed = history({ status: "error" });
    render(<ChangelogView installedVersion="0.4.3" history={failed} now={() => NOW} onOpenLink={vi.fn()} onUpdate={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(failed.onRetry).toHaveBeenCalledOnce();
  });

  it("closes from its close button", () => {
    const { onClose } = renderView("0.4.3");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

const GITHUB_FOOTER =
  "---\r\n\r\n**Downloads:** grab your platform's installer below (macOS Apple Silicon `.dmg`, Windows x86_64 `.msi` / `-setup.exe`, Linux x86_64 or ARM64 `.AppImage` / `.deb`).";

function githubBody(version: string, sections: Record<string, number>, lead?: string): string {
  const lines = [`## What's new in ${version}`, ""];
  if (lead) lines.push(lead, "");
  for (const [heading, count] of Object.entries(sections)) {
    lines.push(`### ${heading}`, "");
    for (let item = 1; item <= count; item += 1) lines.push(`- ${heading} item ${item} in ${version}.`);
    lines.push("");
  }
  lines.push(GITHUB_FOOTER);
  return lines.join("\r\n");
}

function githubRelease(version: string, daysAgo: number, body: string) {
  return { ...release(version, daysAgo), body };
}

function renderEntries(installedVersion: string, entries: ReturnType<typeof githubRelease>[]) {
  render(
    <ChangelogView
      installedVersion={installedVersion}
      history={history({ entries })}
      now={() => NOW}
      onOpenLink={vi.fn()}
      onUpdate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return screen.getAllByTestId("release-timeline-item");
}

describe("ChangelogView release notes", () => {
  beforeAll(() => loadReleaseNotesRenderer());

  it("keeps the GitHub download note out and folds older releases to a section summary", () => {
    const [newest, older] = renderEntries("0.4.3", [
      githubRelease("0.4.3", 1, githubBody("0.4.3", { Added: 1, Fixed: 2 })),
      githubRelease("0.4.2", 4, githubBody("0.4.2", { Added: 1, Fixed: 2 })),
    ]);
    expect(within(newest).getByText("Added item 1 in 0.4.3.")).toBeInTheDocument();
    expect(within(newest).getByText("Fixed item 2 in 0.4.3.")).toBeInTheDocument();
    expect(screen.queryByText(/installer below/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Downloads:/)).not.toBeInTheDocument();

    const summary = within(older).getByRole("button", { expanded: false });
    expect(summary).toHaveTextContent("Added 1 · Fixed 2");
    expect(within(older).queryByText("Fixed item 1 in 0.4.2.")).not.toBeInTheDocument();
    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(within(older).getByText("Fixed item 1 in 0.4.2.")).toBeInTheDocument();
  });

  it("folds the big sections of the newest release behind a count", () => {
    const [newest] = renderEntries("0.4.3", [
      githubRelease("0.4.3", 1, githubBody("0.4.3", { Added: 2, Changed: 1, Fixed: 52, Security: 4 })),
    ]);
    expect(within(newest).getByText("Added item 2 in 0.4.3.")).toBeInTheDocument();
    expect(within(newest).getByText("Changed item 1 in 0.4.3.")).toBeInTheDocument();
    expect(within(newest).queryByText("Fixed item 1 in 0.4.3.")).not.toBeInTheDocument();
    expect(within(newest).queryByText("Security item 1 in 0.4.3.")).not.toBeInTheDocument();

    const fixed = within(newest).getByRole("button", { name: /Fixed/ });
    expect(fixed).toHaveAttribute("aria-expanded", "false");
    expect(fixed).toHaveTextContent("52 changes");
    expect(within(newest).getByRole("button", { name: /Security/ })).toHaveTextContent("4 changes");
    fireEvent.click(fixed);
    expect(fixed).toHaveAttribute("aria-expanded", "true");
    expect(within(newest).getByText("Fixed item 52 in 0.4.3.")).toBeInTheDocument();
    expect(within(newest).queryByText("Security item 1 in 0.4.3.")).not.toBeInTheDocument();
  });

  it("keeps every release newer than the installed one open", () => {
    const items = renderEntries("0.4.1", [
      githubRelease("0.4.3", 1, githubBody("0.4.3", { Added: 1 })),
      githubRelease("0.4.2", 4, githubBody("0.4.2", { Added: 1 })),
      githubRelease("0.4.1", 12, githubBody("0.4.1", { Added: 1 })),
    ]);
    expect(within(items[0]).getByText("Added item 1 in 0.4.3.")).toBeInTheDocument();
    expect(within(items[1]).getByText("Added item 1 in 0.4.2.")).toBeInTheDocument();
    expect(within(items[2]).queryByText("Added item 1 in 0.4.1.")).not.toBeInTheDocument();
    expect(within(items[2]).getByRole("button", { expanded: false })).toHaveTextContent("Added 1");
  });

  it("shows a folded release's opening note once, without a repeated title", () => {
    const repeated = githubBody("0.4.0", { Added: 1 }, "> Before updating from 0.3.13, save your work.").replace(
      "## What's new in 0.4.0\r\n",
      "## What's new in 0.4.0\r\n\r\n## What's new in 0.4.0\r\n",
    );
    const [, older] = renderEntries("0.4.3", [
      githubRelease("0.4.3", 1, githubBody("0.4.3", { Added: 1 })),
      githubRelease("0.4.0", 20, repeated),
    ]);
    expect(within(older).getByText("Before updating from 0.3.13, save your work.")).toBeInTheDocument();
    expect(within(older).queryByText("What's new in 0.4.0")).not.toBeInTheDocument();
    expect(within(older).getByRole("button", { expanded: false })).toHaveTextContent("Added 1");
  });

  it("offers to show the notes of a long folded release that has no sections", () => {
    const install = [
      "Download the installer for your platform below.",
      "",
      ...Array.from({ length: 6 }, (_, index) => `- Install step ${index + 1} for this platform.`),
    ].join("\r\n");
    const [, pointer, legacy] = renderEntries("0.4.3", [
      githubRelease("0.4.3", 1, githubBody("0.4.3", { Added: 1 })),
      githubRelease("0.3.6", 40, "## What's new in 0.3.6\n\nSee the changelog: https://github.com/Oleafly/Oleafly\n\n---\n\n**Downloads:** grab it below.\n"),
      githubRelease("0.1.0", 300, install),
    ]);
    expect(within(pointer).getByText(/See the changelog/)).toBeInTheDocument();
    expect(within(pointer).queryByRole("button", { expanded: false })).not.toBeInTheDocument();
    const show = within(legacy).getByRole("button", { expanded: false });
    expect(show).toHaveTextContent(enShell.changelog.showNotes);
    expect(within(legacy).queryByText("Install step 1 for this platform.")).not.toBeInTheDocument();
    fireEvent.click(show);
    expect(within(legacy).getByText("Install step 1 for this platform.")).toBeInTheDocument();
  });
});

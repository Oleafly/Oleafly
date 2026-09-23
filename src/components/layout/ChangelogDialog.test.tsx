// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangelogView } from "./ChangelogDialog";
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

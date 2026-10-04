// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appVersion: vi.fn(),
  openExternal: vi.fn(async () => {}),
  openUpdateWindow: vi.fn(async () => {}),
  entries: [] as Array<{ version: string; publishedAt: string; body: string; url: string }>,
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.openExternal }));
vi.mock("@/lib/tauri", () => ({ appVersion: mocks.appVersion }));
vi.mock("@/lib/updater", () => ({ openUpdateWindow: mocks.openUpdateWindow }));
vi.mock("@/lib/release-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/release-history")>()),
  useReleaseHistory: () => ({ entries: mocks.entries, status: "done", loadMore: vi.fn(), retry: vi.fn() }),
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { ChangelogDialog } from "./ChangelogDialog";

function release(version: string, url: string) {
  return { version, publishedAt: "2026-09-20T12:00:00Z", body: `## ${version}\n\nNotes.`, url };
}

beforeEach(() => {
  mocks.appVersion.mockReset();
  mocks.openExternal.mockClear();
  mocks.openUpdateWindow.mockClear();
  mocks.entries = [
    release("0.4.3", "https://github.com/Oleafly/Oleafly/releases/tag/v0.4.3"),
    release("0.4.2", "javascript:alert(1)"),
  ];
});

describe("ChangelogDialog", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<ChangelogDialog open={false} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(mocks.appVersion).not.toHaveBeenCalled();
  });

  it("offers the update for an older install and opens only web links", async () => {
    mocks.appVersion.mockResolvedValue("0.4.2");
    render(<ChangelogDialog open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("changelog-status")).toHaveTextContent("v0.4.2"));
    fireEvent.click(screen.getByRole("button", { name: enShell.updateChecker.updateNow }));
    expect(mocks.openUpdateWindow).toHaveBeenCalledWith({ manual: true });

    const items = screen.getAllByTestId("release-timeline-item");
    fireEvent.click(within(items[0]).getByRole("button", { name: enShell.updateWindow.viewRelease }));
    fireEvent.click(within(items[1]).getByRole("button", { name: enShell.updateWindow.viewRelease }));
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith("https://github.com/Oleafly/Oleafly/releases/tag/v0.4.3");
  });

  it("still lists releases when the installed version cannot be read", async () => {
    mocks.appVersion.mockRejectedValue(new Error("no version"));
    render(<ChangelogDialog open onClose={vi.fn()} />);

    await waitFor(() => expect(mocks.appVersion).toHaveBeenCalled());
    expect(screen.getAllByTestId("release-timeline-item")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: enShell.updateChecker.updateNow })).not.toBeInTheDocument();
  });
});

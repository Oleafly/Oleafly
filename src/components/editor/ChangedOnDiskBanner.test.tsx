// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  keepLocalVersion: vi.fn(async () => {}),
  reloadFromDisk: vi.fn(async () => {}),
  notifyError: vi.fn(),
  state: {
    projectId: "linked-a" as string | null,
    activePath: "main.tex" as string | null,
    changedOnDisk: ["main.tex"] as string[],
  },
}));

vi.mock("@/store/files", () => {
  const store = Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        ...mocks.state,
        keepLocalVersion: mocks.keepLocalVersion,
        reloadFromDisk: mocks.reloadFromDisk,
      }),
    {
      getState: () => ({
        ...mocks.state,
        keepLocalVersion: mocks.keepLocalVersion,
        reloadFromDisk: mocks.reloadFromDisk,
      }),
    },
  );
  return { useFilesStore: store };
});
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));

import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { i18n } from "@/i18n";
import { diffKey, useDiffStore } from "@/store/diff";
import { ChangedOnDiskBanner } from "./ChangedOnDiskBanner";

const copy = enEditor.changedOnDisk;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.keepLocalVersion.mockClear();
  mocks.reloadFromDisk.mockClear();
  mocks.notifyError.mockClear();
  mocks.state = { projectId: "linked-a", activePath: "main.tex", changedOnDisk: ["main.tex"] };
  useDiffStore.setState({ diffs: [], activeKey: null });
});
afterEach(cleanup);

describe("ChangedOnDiskBanner", () => {
  it("says the open file changed on disk and offers three choices", () => {
    render(<ChangedOnDiskBanner />);

    expect(screen.getByText(copy.message.replace("{{file}}", "main.tex"))).toBeInTheDocument();
    for (const label of [copy.compare, copy.keepMine, copy.reload]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("stays hidden for a file that did not change", () => {
    mocks.state.activePath = "chapter.tex";
    render(<ChangedOnDiskBanner />);
    expect(screen.queryByRole("button", { name: copy.reload })).not.toBeInTheDocument();
  });

  it("opens a comparison with the version on disk", () => {
    render(<ChangedOnDiskBanner />);
    fireEvent.click(screen.getByRole("button", { name: copy.compare }));
    expect(useDiffStore.getState().activeKey).toBe(diffKey({ path: "main.tex", side: "disk" }));
  });

  it("keeps the edit or reloads the file and closes the comparison", async () => {
    useDiffStore.getState().openDiff("main.tex", "disk");
    render(<ChangedOnDiskBanner />);

    fireEvent.click(screen.getByRole("button", { name: copy.keepMine }));
    await waitFor(() => expect(mocks.keepLocalVersion).toHaveBeenCalledWith("main.tex"));
    await waitFor(() => expect(useDiffStore.getState().diffs).toEqual([]));

    fireEvent.click(screen.getByRole("button", { name: copy.reload }));
    await waitFor(() => expect(mocks.reloadFromDisk).toHaveBeenCalledWith("main.tex"));
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("reports a choice that fails", async () => {
    mocks.reloadFromDisk.mockRejectedValueOnce(new Error("gone"));
    render(<ChangedOnDiskBanner />);
    fireEvent.click(screen.getByRole("button", { name: copy.reload }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "resolve a file changed on disk",
        expect.any(Error),
        copy.failed.replace("{{file}}", "main.tex"),
      ),
    );
  });
});

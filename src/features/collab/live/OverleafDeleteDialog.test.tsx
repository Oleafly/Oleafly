// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({
  overleafLiveDelete: vi.fn(async () => undefined),
  onOverleafLiveTree: vi.fn(async () => () => {}),
}));
const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));

vi.mock("@/lib/overleaf-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-live")>()),
  ...live,
}));
vi.mock("@/lib/log", () => log);

import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { OverleafDeleteDialog } from "./OverleafDeleteDialog";
import { receiveOverleafTree, startOverleafTree, useOverleafTree } from "./overleaf-tree";

const PROJECT = "project-1";

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  live.overleafLiveDelete.mockClear();
  log.logError.mockClear();
  useFilesStore.setState({ projectId: PROJECT });
  useSettingsStore.setState({ overleafDeletes: "ask" });
  useOverleafTree.setState({ projectId: null, asking: [], deciding: false });
});

describe("Overleaf delete question", () => {
  it("asks before deleting on Overleaf and deletes there when told to", async () => {
    receiveOverleafTree({ projectId: PROJECT, kind: "delete_asked", paths: ["figures.tex"] });
    render(<OverleafDeleteDialog />);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete on Overleaf too?");
    expect(dialog).toHaveTextContent(
      "You deleted figures.tex on this computer. Overleaf keeps a file until you delete it there too.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete on Overleaf too" }));
    expect(live.overleafLiveDelete).toHaveBeenCalledExactlyOnceWith(PROJECT, ["figures.tex"], true);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps the files on Overleaf when the person says so, asking once for each file", async () => {
    receiveOverleafTree({ projectId: PROJECT, kind: "delete_asked", paths: ["a.tex"] });
    receiveOverleafTree({ projectId: PROJECT, kind: "delete_asked", paths: ["a.tex", "b.png"] });
    render(<OverleafDeleteDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /^Keep on Overleaf/ }));
    expect(live.overleafLiveDelete).toHaveBeenCalledExactlyOnceWith(PROJECT, ["a.tex", "b.png"], false);
  });

  it("keeps asking when the answer can't be sent", async () => {
    live.overleafLiveDelete.mockRejectedValueOnce(new Error("offline"));
    receiveOverleafTree({ projectId: PROJECT, kind: "delete_asked", paths: ["a.tex"] });
    render(<OverleafDeleteDialog />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete on Overleaf too" }));
    await waitFor(() => expect(log.logError).toHaveBeenCalledOnce());
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("a.tex");
    expect(useOverleafTree.getState()).toMatchObject({ asking: ["a.tex"], deciding: false });
  });

  it("follows the Always and Never settings without asking", () => {
    useSettingsStore.setState({ overleafDeletes: "always" });
    receiveOverleafTree({ projectId: PROJECT, kind: "delete_asked", paths: ["old.tex"] });
    useSettingsStore.setState({ overleafDeletes: "never" });
    receiveOverleafTree({ projectId: PROJECT, kind: "delete_asked", paths: ["kept.tex"] });
    expect(live.overleafLiveDelete.mock.calls).toEqual([
      [PROJECT, ["old.tex"], true],
      [PROJECT, ["kept.tex"], false],
    ]);
    render(<OverleafDeleteDialog />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks only in the project the delete happened in", () => {
    receiveOverleafTree({ projectId: "other", kind: "delete_asked", paths: ["x.tex"] });
    render(<OverleafDeleteDialog />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    receiveOverleafTree({ projectId: PROJECT, kind: "delete_asked", paths: ["y.tex"] });
    expect(useOverleafTree.getState()).toMatchObject({ projectId: PROJECT, asking: ["y.tex"] });
  });

  it("listens for the notices and stops listening", async () => {
    const unlisten = vi.fn();
    live.onOverleafLiveTree.mockResolvedValueOnce(unlisten);
    const stop = startOverleafTree();
    await waitFor(() => expect(live.onOverleafLiveTree).toHaveBeenCalledWith(receiveOverleafTree));
    await Promise.resolve();
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

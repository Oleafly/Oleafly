import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(async (_url: string) => {}),
  openProjectLocation: vi.fn(async (_target: unknown) => true),
  notifyError: vi.fn(),
  files: {
    projectId: "proj" as string | null,
    tree: [] as { path: string; is_dir: boolean; unreadable?: boolean }[],
  },
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/open-location", () => ({ openProjectLocation: mocks.openProjectLocation }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));

import { createTerminalLinkActions } from "./terminal-link-actions";

const tooltip = { hover: vi.fn(), leave: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.projectId = "proj";
  mocks.files.tree = [
    { path: "chapters", is_dir: true },
    { path: "chapters/intro.tex", is_dir: false },
    { path: "main.tex", is_dir: false },
    { path: "locked.tex", is_dir: false, unreadable: true },
  ];
});

describe("createTerminalLinkActions", () => {
  it("resolves paths against the pane's own project tree", () => {
    const actions = createTerminalLinkActions("proj", tooltip);
    expect(actions.resolve("./chapters/intro.tex")).toBe("chapters/intro.tex");
    expect(actions.resolve("intro.tex")).toBe("chapters/intro.tex");
    expect(actions.resolve("chapters")).toBeNull();
    expect(actions.resolve("locked.tex")).toBeNull();
    expect(actions.resolve("/Users/me/proj/main.tex")).toBeNull();
  });

  it("sees a refreshed tree", () => {
    const actions = createTerminalLinkActions("proj", tooltip);
    expect(actions.resolve("figures/plot.png")).toBeNull();
    mocks.files.tree = [...mocks.files.tree, { path: "figures/plot.png", is_dir: false }];
    expect(actions.resolve("figures/plot.png")).toBe("figures/plot.png");
  });

  it("links nothing while another project is open", () => {
    mocks.files.projectId = "other";
    const actions = createTerminalLinkActions("proj", tooltip);
    expect(actions.resolve("main.tex")).toBeNull();
    actions.openFile({ path: "main.tex", line: 2 });
    expect(mocks.openProjectLocation).not.toHaveBeenCalled();
  });

  it("opens a file at its location in the editor", () => {
    createTerminalLinkActions("proj", tooltip).openFile({ path: "main.tex", line: 3, column: 2 });
    expect(mocks.openProjectLocation).toHaveBeenCalledExactlyOnceWith({ path: "main.tex", line: 3, column: 2 });
  });

  it("opens URLs in the system browser and reports a failure", async () => {
    const actions = createTerminalLinkActions("proj", tooltip);
    actions.openUrl("https://typst.app/docs");
    expect(mocks.open).toHaveBeenCalledWith("https://typst.app/docs");

    const failure = new Error("denied");
    mocks.open.mockRejectedValueOnce(failure);
    actions.openUrl("https://example.org/");
    await vi.waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith("open terminal link", failure, "Couldn't open the link."),
    );
  });

  it("passes hover and leave to the tooltip", () => {
    const actions = createTerminalLinkActions("proj", tooltip);
    expect(actions.hover).toBe(tooltip.hover);
    expect(actions.leave).toBe(tooltip.leave);
  });
});

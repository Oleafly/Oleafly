import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("../acp/tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof import("@/lib/tauri")>()),
  writeProjectBytes: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => undefined) }));
import { logError } from "@/lib/log";
import { writeProjectBytes } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import type { ToolEntry } from "@/store/chats";
import { useFilesStore } from "@/store/files";
import { freeFigurePath, ToolPicture } from "./ToolPicture";

const picture: ToolEntry = {
  id: "tool-1",
  name: "load_image",
  status: "done",
  image: "data:image/png;base64,AAAA",
};

const refreshTree = vi.fn<() => Promise<boolean>>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(writeProjectBytes).mockResolvedValue({ generation: 1 });
  refreshTree.mockResolvedValue(true);
  useFilesStore.setState({ projectId: "paper", tree: [], refreshTree });
});
afterEach(cleanup);
afterAll(restore);

function saveFigure() {
  const rendered = render(<ToolPicture tc={picture} />);
  fireEvent.click(rendered.getByTestId("tool-picture-save"));
  return rendered;
}

describe("saving a tool picture to the project", () => {
  it("names the saved file once", async () => {
    saveFigure();

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledExactlyOnceWith("Saved figures/figure.png"),
    );
    expect(writeProjectBytes).toHaveBeenCalledExactlyOnceWith("paper", "figures/figure.png", "AAAA");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps a written figure a success when the tree refresh after it fails", async () => {
    const failure = new Error("listing failed");
    refreshTree.mockRejectedValue(failure);
    saveFigure();

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledExactlyOnceWith("Saved figures/figure.png"),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledExactlyOnceWith("refresh tree after figure save", failure);
  });

  it("reports a write that failed and logs the cause", async () => {
    const failure = new Error("disk full");
    vi.mocked(writeProjectBytes).mockRejectedValue(failure);
    const rendered = saveFigure();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith("The figure could not be saved."),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledExactlyOnceWith("save figure to project", failure);
    expect(refreshTree).not.toHaveBeenCalled();
    await waitFor(() => expect(rendered.getByTestId("tool-picture-save")).not.toBeDisabled());
  });

  it("asks for a project when none is open", async () => {
    useFilesStore.setState({ projectId: null });
    saveFigure();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith("Open a project to save this figure."),
    );
    expect(writeProjectBytes).not.toHaveBeenCalled();
  });
});

describe("the TikZ source view", () => {
  const tikz: ToolEntry = {
    id: "tool-2",
    name: "preview_figure",
    status: "done",
    image: "data:image/png;base64,AAAA",
    code: "\\begin{tikzpicture}\\end{tikzpicture}\n",
  };

  it("copies the source and switches back to the figure", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const rendered = render(<ToolPicture tc={tikz} />);

    fireEvent.click(rendered.getByTestId("tool-picture-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(tikz.code));
    await waitFor(() => expect(rendered.getByTestId("tool-picture-copy").querySelector(".lucide-check")).not.toBeNull());

    fireEvent.click(rendered.getByTestId("tool-picture-view-code"));
    expect(rendered.queryByTestId("tool-image")).toBeNull();
    fireEvent.click(rendered.getByTestId("tool-picture-view-image"));
    expect(rendered.getByTestId("tool-image")).toHaveAttribute("alt", "Rendered figure preview");
    expect(rendered.getByTestId("tool-picture-view-image")).toHaveAttribute("aria-pressed", "true");
  });

  it("saves source that already ends with a newline without adding another", async () => {
    const writeProjectFile = vi.fn(async () => undefined);
    useFilesStore.setState({ writeProjectFile: writeProjectFile as never });
    const rendered = render(<ToolPicture tc={tikz} />);

    fireEvent.click(rendered.getByTestId("tool-picture-save"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledExactlyOnceWith("Saved figures/figure.tex"));
    expect(writeProjectFile).toHaveBeenCalledExactlyOnceWith("paper", "figures/figure.tex", tikz.code);
  });
});

describe("saving an image without a payload", () => {
  it("writes an empty file rather than failing", async () => {
    const rendered = render(<ToolPicture tc={{ ...picture, image: "not-a-data-url" }} />);

    fireEvent.click(rendered.getByTestId("tool-picture-save"));

    await waitFor(() => expect(writeProjectBytes).toHaveBeenCalledExactlyOnceWith("paper", "figures/figure.png", ""));
  });
});

describe("freeFigurePath", () => {
  it("falls back to a timestamped name once every numbered name is taken", () => {
    const taken = ["figures/figure.png", ...Array.from({ length: 9_998 }, (_, index) => `figures/figure-${index + 2}.png`)];
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    expect(freeFigurePath(taken, "png")).toBe("figures/figure-1700000000000.png");
    now.mockRestore();
  });
});


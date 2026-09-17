// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FileEntry } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  insertFigureFromDialog: vi.fn(),
  insertFigurePlaceholder: vi.fn(),
  applyFigureEdit: vi.fn(),
  pickOpenPath: vi.fn(),
  resolveVisualAssetUrl: vi.fn(async (path: string) => (path.endsWith(".png") ? `data:${path}` : null)),
}));

vi.mock("@/components/editor/latex-commands", () => ({
  insertFigureFromDialog: mocks.insertFigureFromDialog,
  insertFigurePlaceholder: mocks.insertFigurePlaceholder,
}));
vi.mock("@/components/editor/figure-edit", () => ({ applyFigureEdit: mocks.applyFigureEdit }));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: mocks.pickOpenPath }));
vi.mock("@/components/editor/wysiwyg/asset-url", () => ({ resolveVisualAssetUrl: mocks.resolveVisualAssetUrl }));
vi.mock("@/lib/toast", () => ({ notifyError: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

import { useFilesStore } from "@/store/files";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { FigureDialog, figureWidthValue, projectImagePaths } from "./FigureDialog";

const TREE: FileEntry[] = [
  { path: "figures", is_dir: true },
  { path: "figures/plot.png", is_dir: false },
  { path: "figures/diagram.svg", is_dir: false },
  { path: "main.tex", is_dir: false },
];

function setProject(tree: FileEntry[], projectId: string | null = "p1"): void {
  useFilesStore.setState({
    projectId,
    mainDoc: "main.tex",
    tree,
    importPaths: vi.fn(async (destDir: string, sources: string[]) => {
      const name = sources[0].split("/").pop() ?? "new.png";
      useFilesStore.setState({
        tree: [...useFilesStore.getState().tree, { path: destDir ? `${destDir}/${name}` : name, is_dir: false }],
      } as never);
    }),
  } as never);
}

function openDialog() {
  const view = render(<FigureDialog />);
  act(() => {
    useFigureDialogStore.getState().setOpen(true);
  });
  return view;
}

function openEditDialog(width: string | null) {
  const view = render(<FigureDialog />);
  act(() => {
    useFigureDialogStore.getState().openForEdit({
      from: 10,
      to: 60,
      path: "figures/plot.png",
      width,
    });
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  setProject(TREE);
});

afterEach(() => {
  act(() => {
    useFigureDialogStore.getState().setOpen(false);
  });
});

describe("helpers", () => {
  it("lists image files sorted and maps width choices", () => {
    expect(projectImagePaths(TREE)).toEqual(["figures/diagram.svg", "figures/plot.png"]);
    expect(figureWidthValue({ width: "full", customWidth: "" })).toBe("\\linewidth");
    expect(figureWidthValue({ width: "custom", customWidth: " 6cm " })).toBe("6cm");
    expect(figureWidthValue({ width: "custom", customWidth: "" })).toBeNull();
  });
});

describe("FigureDialog", () => {
  it("inserts the selected project image with the chosen width, caption and label", async () => {
    openDialog();
    expect(screen.getByTestId("figure-dialog-insert")).toBeDisabled();
    const image = screen.getAllByTestId("figure-dialog-image").find((node) => node.dataset.path === "figures/plot.png");
    if (!image) throw new Error("plot.png is not listed");
    fireEvent.click(image);
    expect(image).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByAltText("Preview of figures/plot.png")).toBeInTheDocument());
    expect((screen.getByTestId("figure-dialog-label") as HTMLInputElement).value).toBe("fig:plot");
    fireEvent.click(screen.getByTestId("figure-dialog-width-full"));
    fireEvent.change(screen.getByTestId("figure-dialog-caption"), { target: { value: "Growth" } });
    fireEvent.click(screen.getByTestId("figure-dialog-insert"));
    expect(mocks.insertFigureFromDialog).toHaveBeenCalledWith({
      path: "figures/plot.png",
      width: "\\linewidth",
      caption: "Growth",
      label: "fig:plot",
    });
    expect(useFigureDialogStore.getState().open).toBe(false);
  });

  it("omits caption and label when their switches are off and accepts a custom width", () => {
    openDialog();
    fireEvent.click(screen.getAllByTestId("figure-dialog-image")[0]);
    fireEvent.click(screen.getByLabelText("Add a caption"));
    fireEvent.click(screen.getByLabelText("Add a label"));
    fireEvent.click(screen.getByTestId("figure-dialog-width-custom"));
    fireEvent.change(screen.getByLabelText("Custom width"), { target: { value: "7cm" } });
    fireEvent.click(screen.getByTestId("figure-dialog-insert"));
    expect(mocks.insertFigureFromDialog).toHaveBeenCalledWith({
      path: "figures/diagram.svg",
      width: "7cm",
      caption: null,
      label: null,
    });
  });

  it("falls back to the placeholder snippet", () => {
    openDialog();
    fireEvent.click(screen.getByTestId("figure-dialog-placeholder"));
    expect(mocks.insertFigurePlaceholder).toHaveBeenCalledOnce();
    expect(mocks.insertFigureFromDialog).not.toHaveBeenCalled();
    expect(useFigureDialogStore.getState().open).toBe(false);
  });

  it("imports an image from disk into the figures folder and selects it", async () => {
    mocks.pickOpenPath.mockResolvedValue("/Users/me/Downloads/new.png");
    openDialog();
    fireEvent.click(screen.getByTestId("figure-dialog-import"));
    await waitFor(() => {
      const added = screen.getAllByTestId("figure-dialog-image").find((node) => node.dataset.path === "figures/new.png");
      expect(added).toHaveAttribute("aria-pressed", "true");
    });
    expect(useFilesStore.getState().importPaths).toHaveBeenCalledWith("figures", ["/Users/me/Downloads/new.png"]);
    expect((screen.getByTestId("figure-dialog-label") as HTMLInputElement).value).toBe("fig:new");
  });

  it("edits an existing image without touching its caption or label", () => {
    openEditDialog("\\linewidth");
    expect(screen.getByText("Edit image")).toBeInTheDocument();
    expect(screen.queryByTestId("figure-dialog-caption")).not.toBeInTheDocument();
    expect(screen.queryByTestId("figure-dialog-label")).not.toBeInTheDocument();
    expect(screen.queryByTestId("figure-dialog-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("figure-dialog-width-full")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("figure-dialog-width-half"));
    fireEvent.click(screen.getByTestId("figure-dialog-insert"));

    expect(mocks.applyFigureEdit).toHaveBeenCalledWith(
      { from: 10, to: 60, path: "figures/plot.png", width: "\\linewidth" },
      { path: "figures/plot.png", width: "0.5\\linewidth" },
    );
    expect(mocks.insertFigureFromDialog).not.toHaveBeenCalled();
    expect(useFigureDialogStore.getState().open).toBe(false);
  });

  it("offers a custom width when the image carries one the presets do not cover", () => {
    openEditDialog("7cm");
    expect(screen.getByTestId("figure-dialog-width-custom")).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByLabelText("Custom width") as HTMLInputElement).value).toBe("7cm");
  });

  it("shows the empty state without images and keeps a cancelled picker quiet", async () => {
    setProject([{ path: "main.tex", is_dir: false }]);
    mocks.pickOpenPath.mockResolvedValue(null);
    openDialog();
    expect(screen.getByText("This project has no images yet. Import one from disk to get started.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("figure-dialog-import"));
    await waitFor(() => expect(mocks.pickOpenPath).toHaveBeenCalledOnce());
    expect(useFilesStore.getState().importPaths).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

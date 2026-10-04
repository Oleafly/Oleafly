// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { MarkdownPreview } from "./MarkdownPreview";

const loadAssetThumbnail = vi.hoisted(() => vi.fn<(project: string, path: string) => Promise<string | null>>());
vi.mock("./cm/hover-asset", () => ({ loadAssetThumbnail }));

function openContent(content: string, projectId = "first") {
  useFilesStore.setState({
    projectId,
    activePath: "chapters/notes.md",
    files: { "chapters/notes.md": { content, dirty: true } },
  });
}

beforeEach(() => {
  loadAssetThumbnail.mockReset().mockResolvedValue(null);
});

it("renders the unsaved Markdown buffer and follows edits and file changes", async () => {
  openContent("# Research notes\n\n| Sample | Result |\n| --- | --- |\n| A | 42 |\n\n$x^2$");
  const { container } = render(<MarkdownPreview />);
  expect(screen.getByRole("heading", { name: "Research notes" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "42" })).toBeVisible();
  expect(container.querySelector(".katex")).not.toBeNull();

  act(() => openContent("# Revised notes\n\n**Unsaved** changes."));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Revised notes" })).toBeVisible());
  expect(screen.queryByRole("heading", { name: "Research notes" })).not.toBeInTheDocument();
  expect(screen.getByText("Unsaved").tagName).toBe("STRONG");

  act(() => useFilesStore.setState({ activePath: "empty.md", files: {} }));
  await waitFor(() => expect(screen.queryByRole("heading")).not.toBeInTheDocument());
});

it("resolves relative images and ignores an old project response", async () => {
  let resolveFirst!: (url: string) => void;
  const first = new Promise<string>((resolve) => { resolveFirst = resolve; });
  loadAssetThumbnail.mockReturnValueOnce(first).mockResolvedValueOnce("data:image/png;base64,current");
  openContent("![Plot](../figures/my%20plot.png)");
  render(<MarkdownPreview />);
  await waitFor(() => expect(loadAssetThumbnail).toHaveBeenCalledWith("first", "figures/my plot.png"));

  act(() => openContent("![Plot](../figures/my%20plot.png)", "second"));
  await waitFor(() => expect(screen.getByRole("img", { name: "Plot" })).toHaveAttribute("src", "data:image/png;base64,current"));
  await act(async () => resolveFirst("data:image/png;base64,stale"));
  expect(screen.getByRole("img", { name: "Plot" })).toHaveAttribute("src", "data:image/png;base64,current");
});

it("shows a web image directly without asking the project", () => {
  openContent('![Logo](https://example.com/logo.png "Brand")');
  render(<MarkdownPreview />);
  const image = screen.getByRole("img", { name: "Logo" });
  expect(image).toHaveAttribute("src", "https://example.com/logo.png");
  expect(image).toHaveAttribute("title", "Brand");
  expect(loadAssetThumbnail).not.toHaveBeenCalled();
});

it("falls back to the alt text for images it cannot load", async () => {
  openContent("![Broken %E0%A4%A](bad%E0%A4%A.png)\n\n![Outside](../../../escape.png)\n\n![Missing](missing.png)\n\n![]()");
  render(<MarkdownPreview />);
  await waitFor(() => expect(loadAssetThumbnail).toHaveBeenCalledWith("first", "chapters/missing.png"));
  expect(loadAssetThumbnail).toHaveBeenCalledOnce();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("Missing")).toBeInTheDocument();
  expect(screen.getByText("Outside")).toBeInTheDocument();
});

it("shows alt text for project images while no project is open", () => {
  openContent("![Plot](plot.png)", "");
  useFilesStore.setState({ projectId: null });
  render(<MarkdownPreview />);
  expect(screen.getByText("Plot")).toBeInTheDocument();
  expect(loadAssetThumbnail).not.toHaveBeenCalled();
});

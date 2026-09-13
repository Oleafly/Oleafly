// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { DocumentOutline } from "./DocumentOutline";

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: vi.fn(),
}));

function indexWith(
  sections: readonly {
    name: string;
    line: number;
    from: number;
    level: number;
    file?: string;
  }[],
) {
  return {
    defs: sections.map((section) => ({
      kind: "section" as const,
      name: section.name,
      file: section.file ?? "main.tex",
      line: section.line,
      from: section.from,
      to: section.from + section.name.length,
      nameFrom: section.from,
      nameTo: section.from + section.name.length,
      level: section.level,
    })),
    uses: [],
  };
}

function mount(
  index: ReturnType<typeof indexWith> | null,
  activePath: string,
  texts: Record<string, string> = {},
  projectId = "outline-project-a",
) {
  useIndexStore.setState({ index: index as never, texts });
  useFilesStore.setState({ projectId, activePath } as never);
  return render(<DocumentOutline />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useFilesStore.setState({ projectId: null, activePath: null } as never);
});

describe("DocumentOutline", () => {
  it("lists the sections of the active document in order", () => {
    mount(
      indexWith([
        { name: "Introduction", line: 3, from: 10, level: 1 },
        { name: "Background", line: 9, from: 60, level: 1 },
        { name: "Attention", line: 14, from: 120, level: 2 },
      ]),
      "main.tex",
    );

    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("Background")).toBeInTheDocument();
    expect(screen.getByText("Attention")).toBeInTheDocument();
  });

  it("presents escaped characters and project macros as readable titles", () => {
    mount(
      indexWith([
        {
          name: "Evaluation \\& Open-source Implementations",
          line: 3,
          from: 10,
          level: 1,
        },
        {
          name: "\\oursfull{} (\\oursabbrv{})",
          line: 9,
          from: 80,
          level: 2,
        },
        {
          name: "\\textbf{Results}: 100\\% of \\#1\\_rank costs \\$5",
          line: 12,
          from: 140,
          level: 2,
        },
        {
          name: "\\LaTeX{} systems vs.\\ alternatives",
          line: 15,
          from: 210,
          level: 2,
        },
      ]),
      "main.tex",
      {
        "main.tex": [
          "\\newcommand{\\oursfull}{Vision Transformer\\xspace}",
          "\\newcommand{\\oursabbrv}{ViT\\xspace}",
          "\\subsection{\\oursfull{} (\\oursabbrv{})}",
        ].join("\n"),
      },
    );

    expect(
      screen.getByText("Evaluation & Open-source Implementations"),
    ).toBeInTheDocument();
    expect(screen.getByText("Vision Transformer (ViT)"))
      .toBeInTheDocument();
    expect(
      screen.getByText("Results: 100% of #1_rank costs $5"),
    ).toBeInTheDocument();
    expect(screen.getByText("LaTeX systems vs. alternatives"))
      .toBeInTheDocument();
    expect(
      screen.getByText("LaTeX systems vs. alternatives").closest("button"),
    ).toHaveClass("text-[13px]");
  });

  it("indents by heading depth so the shape reads without the titles", () => {
    mount(
      indexWith([
        { name: "Model Architecture", line: 3, from: 10, level: 1 },
        { name: "Attention", line: 6, from: 40, level: 2 },
      ]),
      "main.tex",
    );

    const parent = screen.getByText("Model Architecture").closest("div");
    const child = screen.getByText("Attention").closest("div");
    expect(parent).toHaveClass("min-h-7", "py-1", "leading-5");
    expect(child).toHaveClass("min-h-7", "py-1", "leading-5");
    const indent = (element: Element | null | undefined) =>
      Number.parseInt(
        (element as HTMLElement | null)?.style.paddingLeft ?? "0",
        10,
      );
    expect(indent(child)).toBeGreaterThan(indent(parent));
  });

  it("navigates through the shared project navigation, not a timed jump", () => {
    mount(
      indexWith([{ name: "Introduction", line: 3, from: 10, level: 1 }]),
      "main.tex",
    );

    fireEvent.click(screen.getByText("Introduction"));

    expect(navigateToProjectRange).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "main.tex",
        range: { from: 10, to: 22 },
      }),
    );
  });

  it("is expanded by default, because it answers the question you have while writing", () => {
    mount(
      indexWith([{ name: "Introduction", line: 3, from: 10, level: 1 }]),
      "main.tex",
    );

    const toggle = screen.getByRole("button", { name: /outline/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Introduction")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Introduction")).toBeNull();
  });

  it("collapses descendant headings while keeping top-level headings visible", () => {
    mount(
      indexWith([
        { name: "Introduction", line: 3, from: 10, level: 1 },
        { name: "Motivation", line: 6, from: 40, level: 2 },
        { name: "Details", line: 9, from: 70, level: 3 },
        { name: "Results", line: 12, from: 100, level: 1 },
      ]),
      "main.tex",
    );

    const collapseAll = screen.getByRole("button", { name: "Collapse all headings" });
    expect(collapseAll).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Expand all headings" }),
    ).not.toBeInTheDocument();

    fireEvent.click(collapseAll);
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(screen.queryByText("Motivation")).not.toBeInTheDocument();
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse all headings" }),
    ).not.toBeInTheDocument();
    const expandAll = screen.getByRole("button", { name: "Expand all headings" });
    expect(expandAll).toBe(collapseAll);
    expect(expandAll).toBeEnabled();

    fireEvent.click(expandAll);
    expect(screen.getByText("Motivation")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
  });

  it("toggles a heading branch without changing the navigation action", () => {
    mount(
      indexWith([
        { name: "Introduction", line: 3, from: 10, level: 1 },
        { name: "Motivation", line: 6, from: 40, level: 2 },
        { name: "Details", line: 9, from: 70, level: 3 },
      ]),
      "main.tex",
    );

    const branch = screen.getByRole("button", { name: "Collapse Motivation" });
    expect(branch).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(branch);
    expect(branch).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Details")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Motivation"));
    expect(navigateToProjectRange).toHaveBeenCalledWith(
      expect.objectContaining({ path: "main.tex", range: { from: 40, to: 50 } }),
    );
  });

  it("resets collapsed headings for a different project with an identical outline", async () => {
    const index = indexWith([
      { name: "Introduction", line: 3, from: 10, level: 1 },
      { name: "Motivation", line: 6, from: 40, level: 2 },
    ]);
    const { rerender } = mount(index, "main.tex", {}, "outline-project-a");

    fireEvent.click(screen.getByRole("button", { name: "Collapse all headings" }));
    expect(screen.queryByText("Motivation")).not.toBeInTheDocument();

    useFilesStore.setState({ projectId: "outline-project-b" } as never);
    rerender(<DocumentOutline />);

    await waitFor(() =>
      expect(screen.getByText("Motivation")).toBeInTheDocument(),
    );
  });

  it("keeps whole-section collapse controlled by its owner", () => {
    useIndexStore.setState({
      index: indexWith([{ name: "Introduction", line: 3, from: 10, level: 1 }]) as never,
    });
    useFilesStore.setState({ activePath: "main.tex" } as never);
    const onCollapsedChange = vi.fn();
    render(
      <DocumentOutline collapsed={false} onCollapsedChange={onCollapsedChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /outline/i }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("Introduction")).toBeInTheDocument();
  });

  it("starts an empty outline closed and centers a useful empty state", async () => {
    mount(indexWith([]), "main.tex");
    const outlineToggle = screen.getByRole("button", { name: /outline/i });
    await waitFor(() =>
      expect(outlineToggle).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
    fireEvent.click(outlineToggle);
    expect(
      screen.getByText("No sections or includes in this document."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add a section heading to build a navigable outline."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status").parentElement).toHaveClass(
      "items-center",
      "justify-center",
    );
  });

  it("keeps a manual collapse when an empty document is followed by headings", async () => {
    mount(
      indexWith([
        {
          name: "Introduction",
          line: 3,
          from: 10,
          level: 1,
          file: "first.tex",
        },
      ]),
      "first.tex",
    );
    const outlineToggle = screen.getByRole("button", { name: /outline/i });

    fireEvent.click(outlineToggle);
    expect(outlineToggle).toHaveAttribute("aria-expanded", "false");

    act(() => {
      useIndexStore.setState({ index: indexWith([]) as never });
      useFilesStore.setState({ activePath: "empty.tex" } as never);
    });
    await waitFor(() =>
      expect(outlineToggle).toHaveAttribute("aria-expanded", "false"),
    );

    act(() => {
      useIndexStore.setState({
        index: indexWith([
          {
            name: "Results",
            line: 8,
            from: 60,
            level: 1,
            file: "next.tex",
          },
        ]) as never,
      });
      useFilesStore.setState({ activePath: "next.tex" } as never);
    });
    await waitFor(() =>
      expect(outlineToggle).toHaveAttribute("aria-expanded", "false"),
    );
  });
});

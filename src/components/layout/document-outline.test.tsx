// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function mount(index: ReturnType<typeof indexWith> | null, activePath: string) {
  useIndexStore.setState({ index: index as never });
  useFilesStore.setState({ activePath } as never);
  return render(<DocumentOutline />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

  it("indents by heading depth so the shape reads without the titles", () => {
    mount(
      indexWith([
        { name: "Model Architecture", line: 3, from: 10, level: 1 },
        { name: "Attention", line: 6, from: 40, level: 2 },
      ]),
      "main.tex",
    );

    const parent = screen.getByText("Model Architecture").closest("button");
    const child = screen.getByText("Attention").closest("button");
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

  it("says so plainly when the document has no sections", () => {
    mount(indexWith([]), "main.tex");
    expect(
      screen.getByText("No sections or includes in this document."),
    ).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installScrollGeometry, type ScrollGeometry } from "@/lib/test-scroll-geometry";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { DocumentOutline } from "./DocumentOutline";

vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: vi.fn(),
}));

type Section = Readonly<{ name: string; line: number; from: number; level: number }>;

function indexWith(sections: readonly Section[]) {
  return {
    defs: sections.map((section) => ({
      kind: "section" as const,
      name: section.name,
      file: "main.tex",
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

const SECTIONS: readonly Section[] = [
  { name: "Introduction", line: 3, from: 10, level: 1 },
  { name: "Background", line: 9, from: 60, level: 2 },
  { name: "Method", line: 14, from: 120, level: 1 },
  { name: "Design", line: 20, from: 180, level: 2 },
];

function show(sections: readonly Section[], projectId: string) {
  act(() => {
    useIndexStore.setState({ index: indexWith(sections) as never, texts: {}, building: false });
    useFilesStore.setState({ projectId, activePath: "main.tex" } as never);
  });
}

beforeEach(() => {
  show(SECTIONS, "outline-a");
});

afterEach(() => {
  useFilesStore.setState({ projectId: null, activePath: null } as never);
});

describe("DocumentOutline view memory", () => {
  it("keeps collapsed headings after the panel is closed and reopened", () => {
    const first = render(<DocumentOutline />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Introduction" }));
    expect(screen.queryByText("Background")).not.toBeInTheDocument();
    first.unmount();

    render(<DocumentOutline />);

    expect(screen.getByRole("button", { name: "Expand Introduction" })).toBeInTheDocument();
    expect(screen.queryByText("Background")).not.toBeInTheDocument();
    expect(screen.getByText("Design")).toBeInTheDocument();
  });

  it("starts another project expanded and restores the first project's headings on return", () => {
    const first = render(<DocumentOutline />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Introduction" }));
    first.unmount();

    show(SECTIONS, "outline-b");
    const second = render(<DocumentOutline />);
    expect(screen.getByText("Background")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Method" }));
    second.unmount();

    show(SECTIONS, "outline-a");
    const third = render(<DocumentOutline />);
    expect(screen.queryByText("Background")).not.toBeInTheDocument();
    expect(screen.getByText("Design")).toBeInTheDocument();
    third.unmount();

    show(SECTIONS, "outline-b");
    render(<DocumentOutline />);
    expect(screen.getByText("Background")).toBeInTheDocument();
    expect(screen.queryByText("Design")).not.toBeInTheDocument();
  });

  it("swaps in the remembered headings of a project opened while the panel stays mounted", () => {
    render(<DocumentOutline />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Introduction" }));

    show(SECTIONS, "outline-b");
    expect(screen.getByText("Background")).toBeInTheDocument();

    show(SECTIONS, "outline-a");
    expect(screen.queryByText("Background")).not.toBeInTheDocument();
    expect(screen.getByText("Design")).toBeInTheDocument();
  });

  it("keeps the remembered headings while the outline is still being rebuilt", () => {
    const first = render(<DocumentOutline />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Introduction" }));
    first.unmount();

    act(() => {
      useIndexStore.setState({ index: null, building: true });
    });
    render(<DocumentOutline />);
    show(SECTIONS, "outline-a");

    expect(screen.getByRole("button", { name: "Expand Introduction" })).toBeInTheDocument();
    expect(screen.queryByText("Background")).not.toBeInTheDocument();
  });

  it("still forgets headings that are no longer in the document", () => {
    const first = render(<DocumentOutline />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Introduction" }));
    first.unmount();

    render(<DocumentOutline />);
    show(SECTIONS.filter((section) => section.name !== "Introduction" && section.name !== "Background"), "outline-a");
    show(SECTIONS, "outline-a");

    expect(screen.getByRole("button", { name: "Collapse Introduction" })).toBeInTheDocument();
    expect(screen.getByText("Background")).toBeInTheDocument();
  });
});

function ControlledOutline() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="expand-controlled-outline"
        onClick={() => setCollapsed(false)}
      />
      <DocumentOutline collapsed={collapsed} onCollapsedChange={setCollapsed} />
    </>
  );
}

describe("DocumentOutline empty-document ownership", () => {
  it("does not close an empty outline again that the reader opened before leaving", async () => {
    show([], "outline-a");
    const first = render(<ControlledOutline />);
    const toggle = () => screen.getByRole("button", { name: /outline/i });
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-expanded", "false"));
    fireEvent.click(screen.getByTestId("expand-controlled-outline"));
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    first.unmount();

    render(<ControlledOutline />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("still closes an empty outline for a project it has not seen", async () => {
    show([], "outline-a");
    const first = render(<ControlledOutline />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /outline/i })).toHaveAttribute("aria-expanded", "false"),
    );
    first.unmount();

    show([], "outline-b");
    render(<ControlledOutline />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /outline/i })).toHaveAttribute("aria-expanded", "false"),
    );
  });
});

describe("DocumentOutline scroll memory", () => {
  const MANY: readonly Section[] = Array.from({ length: 120 }, (_, index) => ({
    name: `Section ${String(index).padStart(3, "0")}`,
    line: index + 1,
    from: index * 40,
    level: 1,
  }));
  let geometry: ScrollGeometry;

  beforeEach(() => {
    show(MANY, "outline-a");
    geometry = installScrollGeometry({
      isScroller: (element) => element.classList.contains("overflow-auto"),
      contentHeight: (scroller) => scroller.children.length * 28,
      viewportHeight: 280,
    });
  });

  afterEach(() => {
    geometry.restore();
  });

  const scroller = () => {
    const element = screen.getByText("Section 000").closest<HTMLElement>(".overflow-auto");
    if (!element) throw new Error("missing scroller");
    return element;
  };

  it("returns to the scroll position where the outline was left", () => {
    const first = render(<DocumentOutline />);
    geometry.scrollTo(scroller(), 1_400);
    expect(scroller().scrollTop).toBe(1_400);
    first.unmount();

    render(<DocumentOutline />);

    expect(scroller().scrollTop).toBe(1_400);
    expect(geometry.pendingFrames()).toBe(0);
  });

  it("starts another project at the top and restores the first project's position", () => {
    const first = render(<DocumentOutline />);
    geometry.scrollTo(scroller(), 1_400);
    first.unmount();

    show(MANY, "outline-b");
    const second = render(<DocumentOutline />);
    expect(scroller().scrollTop).toBe(0);
    geometry.scrollTo(scroller(), 560);
    second.unmount();

    show(MANY, "outline-a");
    const third = render(<DocumentOutline />);
    expect(scroller().scrollTop).toBe(1_400);
    third.unmount();

    show(MANY, "outline-b");
    render(<DocumentOutline />);
    expect(scroller().scrollTop).toBe(560);
  });

  it("scrolls a project opened while mounted to the position remembered for it", () => {
    render(<DocumentOutline />);
    geometry.scrollTo(scroller(), 1_400);

    show(MANY, "outline-b");
    expect(scroller().scrollTop).toBe(0);

    show(MANY, "outline-a");
    expect(scroller().scrollTop).toBe(1_400);
  });
});

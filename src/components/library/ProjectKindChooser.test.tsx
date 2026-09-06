// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectKindChooser } from "./ProjectKindChooser";

describe("ProjectKindChooser", () => {
  it("offers the three starting points with a thumbnail each and reports the choice", () => {
    const onChoose = vi.fn();
    render(<ProjectKindChooser open onClose={vi.fn()} onChoose={onChoose} />);

    const chooser = screen.getByTestId("project-kind-chooser");
    expect(chooser).toHaveTextContent("Start a new piece of work");
    for (const id of ["research", "import", "template"]) {
      const card = screen.getByTestId(`project-kind-${id}`);
      expect(card.querySelector("img")).toHaveAttribute(
        "src",
        expect.stringContaining(".webp"),
      );
    }

    fireEvent.click(screen.getByTestId("project-kind-research"));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("research");
    fireEvent.click(screen.getByTestId("project-kind-import"));
    expect(onChoose).toHaveBeenLastCalledWith("import");
    fireEvent.click(screen.getByTestId("project-kind-template"));
    expect(onChoose).toHaveBeenLastCalledWith("template");
  });

  it("closes on escape, and refuses to while closing is held back", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ProjectKindChooser open onClose={onClose} onChoose={vi.fn()} />,
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    rerender(
      <ProjectKindChooser open allowClose={false} onClose={onClose} onChoose={vi.fn()} />,
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    render(<ProjectKindChooser open={false} onClose={vi.fn()} onChoose={vi.fn()} />);
    expect(screen.queryByTestId("project-kind-chooser")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Book } from "./Book";

describe("Book project metadata", () => {
  it("can expose a recovery-specific open action", () => {
    render(
      <Book
        title={"recovery-project"}
        engine="Recovery required"
        kind="Open to recover"
        openLabel="Open to recover recovery-project"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Open to recover recovery-project",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Open to recover")).toBeInTheDocument();
  });

  it("shows the engine without an icon for a regular project", () => {
    const { container } = render(
      <Book title={"Paper"} engine="Tectonic" kind="document" />,
    );

    expect(screen.getByText("Tectonic")).toBeInTheDocument();
    expect(screen.getByText("document")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByLabelText(/Forked from/u)).toBeNull();
  });

  it("shows the kind on the cover and an inline fork marker beside the engine only for a fork", () => {
    render(
      <Book
        title={"Paper copy"}
        engine="LaTeX"
        kind="Document"
        forkedFrom="Original paper"
      />,
    );

    expect(screen.getByTestId("project-card-kind")).toHaveTextContent("Document");
    const engine = screen.getByTestId("project-card-engine");
    const fork = screen.getByLabelText("Forked from Original paper");
    expect(engine).toHaveTextContent("LaTeX");
    expect(engine.parentElement).toContainElement(fork);
    expect(engine.parentElement).toHaveClass("gap-1.5");
    expect(engine.parentElement).toHaveTextContent("LaTeX•");
    expect(fork.querySelector("svg")).toBeInTheDocument();
  });
});

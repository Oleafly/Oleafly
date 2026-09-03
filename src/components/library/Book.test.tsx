// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Book } from "./Book";

describe("Book project metadata", () => {
  it("can expose a recovery-specific open action", () => {
    render(
      <Book
        title="recovery-project"
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
      <Book title="Paper" engine="Tectonic" kind="document" />,
    );

    expect(screen.getByText("Tectonic")).toBeInTheDocument();
    expect(screen.getByText("document")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByLabelText(/Forked from/u)).toBeNull();
  });

  it("shows an inline fork marker beside the project type only for a fork", () => {
    render(
      <Book
        title="Paper copy"
        engine="Tectonic"
        kind="document"
        forkedFrom="Original paper"
      />,
    );

    const kind = screen.getByText("document");
    const fork = screen.getByLabelText("Forked from Original paper");
    expect(kind.parentElement).toContainElement(fork);
    expect(kind.parentElement).toHaveClass("gap-1.5");
    expect(kind.parentElement).toHaveTextContent("document•");
    expect(fork.querySelector("svg")).toBeInTheDocument();
  });
});

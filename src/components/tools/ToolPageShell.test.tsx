// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useHomeViewStore } from "@/store/home-view";
import { ToolPageShell } from "./ToolPageShell";

beforeEach(() => {
  useHomeViewStore.setState({ page: "library" });
});

describe("ToolPageShell", () => {
  it("renders nothing when its page isn't active", () => {
    const { container } = render(
      <ToolPageShell page="bibtex" title="BibTeX Validator" testId="bibtex-tool-view">
        <div>content</div>
      </ToolPageShell>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders its children and title when active", () => {
    useHomeViewStore.setState({ page: "bibtex" });
    render(
      <ToolPageShell page="bibtex" title="BibTeX Validator" testId="bibtex-tool-view">
        <div>content</div>
      </ToolPageShell>,
    );
    expect(screen.getByTestId("bibtex-tool-view")).toBeInTheDocument();
    expect(screen.getByText("BibTeX Validator")).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("the back button returns to library", () => {
    useHomeViewStore.setState({ page: "bibtex" });
    render(
      <ToolPageShell page="bibtex" title="BibTeX Validator" testId="bibtex-tool-view">
        <div>content</div>
      </ToolPageShell>,
    );
    fireEvent.click(screen.getByTestId("bibtex-tool-view-back"));
    expect(useHomeViewStore.getState().page).toBe("library");
  });
});

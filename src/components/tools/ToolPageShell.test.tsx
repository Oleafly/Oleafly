// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";
import { ToolPageShell } from "./ToolPageShell";

const title = enResearchTools.tools.bibtex.name;
const body = "content";

beforeEach(() => {
  useHomeViewStore.setState({ page: "library" });
  useFilesStore.setState({ projectId: null });
});

describe("ToolPageShell", () => {
  it("renders nothing when its page isn't active", () => {
    const { container } = render(
      <ToolPageShell page="bibtex" title={title} testId="bibtex-tool-view">
        <div>{body}</div>
      </ToolPageShell>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders its children and title when active", () => {
    useHomeViewStore.setState({ page: "bibtex" });
    render(
      <ToolPageShell page="bibtex" title={title} testId="bibtex-tool-view">
        <div>{body}</div>
      </ToolPageShell>,
    );
    expect(screen.getByTestId("bibtex-tool-view")).toBeInTheDocument();
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
  });

  it("the back button returns to the tools page", () => {
    useHomeViewStore.setState({ page: "bibtex" });
    useFilesStore.setState({ projectId: "open-project" });
    render(
      <ToolPageShell page="bibtex" title={title} testId="bibtex-tool-view">
        <div>{body}</div>
      </ToolPageShell>,
    );
    fireEvent.click(screen.getByTestId("bibtex-tool-view-back"));
    expect(useHomeViewStore.getState().page).toBe("tools");
  });

  it("the tools page returns to the library", () => {
    useHomeViewStore.setState({ page: "tools" });
    render(
      <ToolPageShell page="tools" title={enResearchTools.tools.galleryTitle} testId="latex-tools-view">
        <div>{enResearchTools.tools.gallerySubtitle}</div>
      </ToolPageShell>,
    );
    fireEvent.click(screen.getByTestId("latex-tools-view-back"));
    expect(useHomeViewStore.getState().page).toBe("library");
  });
});

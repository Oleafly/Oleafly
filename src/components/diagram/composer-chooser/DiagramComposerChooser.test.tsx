// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiagramComposerStore } from "@/store/diagram-composer";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { DiagramComposerChooser, DiagramComposerChooserHost } from "./DiagramComposerChooser";

const LANGUAGES = ["tikz", "typst", "mermaid"] as const;

beforeEach(() => {
  useDiagramComposerStore.setState({ language: "tikz", requestId: 0, chooserOpen: false });
  useHomeViewStore.setState({ page: "library", queuedPageAfterProjectClose: null });
  useFilesStore.setState({ projectId: null });
});

describe("DiagramComposerChooser", () => {
  it("offers TikZ, Typst and Mermaid with a picture each and reports the choice", () => {
    const onChoose = vi.fn();
    render(<DiagramComposerChooser open onClose={vi.fn()} onChoose={onChoose} />);

    const chooser = screen.getByTestId("diagram-composer-chooser");
    expect(chooser).toHaveTextContent("Choose a diagram composer");
    expect(chooser).toHaveTextContent("Pick the kind of document the diagram is for.");
    const titles = { tikz: "TikZ diagram", typst: "Typst diagram", mermaid: "Mermaid diagram" };
    for (const language of LANGUAGES) {
      const card = screen.getByTestId(`diagram-composer-choice-${language}`);
      expect(card).toHaveTextContent(titles[language]);
      expect(card.querySelector("img")).toHaveAttribute(
        "src",
        `/project-kind/diagram-${language}-light.webp`,
      );
      expect(card.querySelector("img")).toHaveAttribute("alt", "");
      expect(card).toHaveAccessibleDescription(/.+/);
      expect(card.outerHTML).not.toMatch(/(^|[\s"])(focus-visible:|focus:)?(ring|outline)-/);
    }

    for (const language of LANGUAGES) {
      fireEvent.click(screen.getByTestId(`diagram-composer-choice-${language}`));
      expect(onChoose).toHaveBeenLastCalledWith(language);
    }
    expect(onChoose).toHaveBeenCalledTimes(3);
  });

  it("moves between the cards with the arrow keys and picks one with Enter", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<DiagramComposerChooser open onClose={vi.fn()} onChoose={onChoose} />);
    const card = (language: (typeof LANGUAGES)[number]) =>
      screen.getByTestId(`diagram-composer-choice-${language}`);

    expect(card("tikz")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(card("typst")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(card("mermaid")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(card("tikz")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(card("mermaid")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(card("tikz")).toHaveFocus();
    await user.keyboard("{End}");
    expect(card("mermaid")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(card("typst")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("typst");
  });

  it("closes on escape", () => {
    const onClose = vi.fn();
    render(<DiagramComposerChooser open onClose={onClose} onChoose={vi.fn()} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders nothing while closed", () => {
    render(<DiagramComposerChooser open={false} onClose={vi.fn()} onChoose={vi.fn()} />);
    expect(screen.queryByTestId("diagram-composer-chooser")).not.toBeInTheDocument();
  });
});

describe("DiagramComposerChooserHost", () => {
  it("stays closed until something asks for the chooser", () => {
    render(<DiagramComposerChooserHost />);
    expect(screen.queryByTestId("diagram-composer-chooser")).not.toBeInTheDocument();
    act(() => useDiagramComposerStore.getState().setChooserOpen(true));
    expect(screen.getByTestId("diagram-composer-chooser")).toBeInTheDocument();
  });

  it.each(LANGUAGES)("lands in the %s composer and leaves no chooser behind", async (language) => {
    useDiagramComposerStore.setState({ chooserOpen: true });
    render(<DiagramComposerChooserHost />);

    fireEvent.click(screen.getByTestId(`diagram-composer-choice-${language}`));

    await vi.waitFor(() => expect(useHomeViewStore.getState().page).toBe("diagram-composer"));
    expect(useDiagramComposerStore.getState()).toMatchObject({
      language,
      requestId: 1,
      chooserOpen: false,
    });
    expect(screen.queryByTestId("diagram-composer-chooser")).not.toBeInTheDocument();
  });

  it("closes without opening the composer when dismissed", () => {
    useDiagramComposerStore.setState({ chooserOpen: true });
    render(<DiagramComposerChooserHost />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(useDiagramComposerStore.getState()).toMatchObject({ chooserOpen: false, requestId: 0 });
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("opens again after a choice", () => {
    useDiagramComposerStore.setState({ chooserOpen: true });
    render(<DiagramComposerChooserHost />);
    fireEvent.click(screen.getByTestId("diagram-composer-choice-typst"));
    expect(screen.queryByTestId("diagram-composer-chooser")).not.toBeInTheDocument();
    act(() => useDiagramComposerStore.getState().setChooserOpen(true));
    expect(screen.getByTestId("diagram-composer-chooser")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { ReadOnlyLatex } from "./ReadOnlyLatex";

function viewIn(host: HTMLElement): EditorView {
  const content = host.querySelector(".cm-content");
  const view = content ? EditorView.findFromDOM(content as HTMLElement) : null;
  if (!view) throw new Error("no editor mounted");
  return view;
}

const originalTheme = useSettingsStore.getState().editorTheme;

afterEach(() => {
  useSettingsStore.setState({ editorTheme: originalTheme });
});

describe("ReadOnlyLatex", () => {
  it("shows LaTeX source that cannot be edited", () => {
    useSettingsStore.setState({ editorTheme: "dracula" as never });
    render(<ReadOnlyLatex source={"\\section{Intro}"} testId="snippet" className="rounded" />);
    const host = screen.getByTestId("snippet");
    expect(host).toHaveClass("rounded");
    expect(host).toHaveAttribute("data-editor-theme", "dracula");
    const view = viewIn(host);
    expect(view.state.doc.toString()).toBe("\\section{Intro}");
    expect(view.state.readOnly).toBe(true);
    expect(host.querySelector(".cm-lineNumbers")).toBeNull();
  });

  it("adds a line-number gutter on request", () => {
    render(<ReadOnlyLatex source="a" gutter testId="snippet" />);
    expect(screen.getByTestId("snippet").querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  it("keeps the same editor and replaces its text when the source changes", () => {
    const { rerender, unmount } = render(<ReadOnlyLatex source="first" testId="snippet" />);
    const view = viewIn(screen.getByTestId("snippet"));
    rerender(<ReadOnlyLatex source="second" testId="snippet" />);
    expect(viewIn(screen.getByTestId("snippet"))).toBe(view);
    expect(view.state.doc.toString()).toBe("second");
    rerender(<ReadOnlyLatex source="second" testId="snippet" />);
    expect(view.state.doc.toString()).toBe("second");
    unmount();
    expect(view.dom.isConnected).toBe(false);
  });
});

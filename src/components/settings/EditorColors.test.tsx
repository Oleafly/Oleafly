// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { EditorColors } from "./EditorColors";

vi.mock("@/lib/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/theme")>()),
  useTheme: () => ({ theme: "light" }),
}));

function openSection() {
  render(<EditorColors />);
  fireEvent.click(screen.getByTestId("editor-colors-toggle"));
}

const preview = () => screen.getByTestId("settings-editor-colors-preview");

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ editorThemeLight: "paper", editorThemeDark: "nord", editorColors: {} });
});

afterEach(() => {
  useSettingsStore.setState({ editorThemeLight: "system", editorThemeDark: "system", editorColors: {} });
});

describe("EditorColors", () => {
  it("previews the theme picked for the mode being edited", () => {
    openSection();
    expect(screen.getByTestId("settings-editor-colors-theme")).toHaveTextContent("Editing Paper");
    expect(preview()).toHaveAttribute("data-editor-theme", "paper");
    expect(preview().parentElement).toHaveClass("light");
    expect(preview()).toHaveTextContent(String.raw`\documentclass[12pt]{article}`);

    fireEvent.click(screen.getByTestId("settings-editor-colors-mode-dark"));
    expect(screen.getByTestId("settings-editor-colors-theme")).toHaveTextContent("Editing Nord");
    expect(preview()).toHaveAttribute("data-editor-theme", "nord");
    expect(preview().parentElement).toHaveClass("dark");

    fireEvent.click(screen.getByTestId("settings-editor-colors-sample-markdown"));
    expect(preview()).toHaveTextContent("# Results");
  });

  it("saves a color for the edited theme, previews it and sets it back to the theme's", () => {
    openSection();
    const row = screen.getByTestId("settings-editor-color-heading");
    fireEvent.change(within(row).getByLabelText("Pick a color for Headings"), {
      target: { value: "#123456" },
    });

    expect(useSettingsStore.getState().editorColors).toEqual({ paper: { heading: "#123456" } });
    expect(row).toHaveAttribute("data-custom", "true");
    const scope = preview().parentElement as HTMLElement;
    expect(scope.style.getPropertyValue("--cm-user-heading")).toBe("#123456");
    expect(scope.style.getPropertyValue("--cm-user-comment")).toBe("initial");

    fireEvent.click(within(row).getByRole("button", { name: "Use the theme color for Headings" }));
    expect(useSettingsStore.getState().editorColors).toEqual({});
    expect(row).toHaveAttribute("data-custom", "false");
  });

  it("resets every color of the edited theme and keeps the other theme's", () => {
    useSettingsStore.setState({
      editorColors: { paper: { heading: "#123456", background: "#fefefe" }, nord: { comment: "#654321" } },
    });
    openSection();

    fireEvent.click(screen.getByTestId("settings-editor-colors-reset"));

    expect(useSettingsStore.getState().editorColors).toEqual({ nord: { comment: "#654321" } });
    expect(screen.queryByTestId("settings-editor-colors-reset")).not.toBeInTheDocument();
  });

  it("keeps Match app colors for light mode apart from dark mode", () => {
    useSettingsStore.setState({ editorThemeLight: "system", editorThemeDark: "system" });
    openSection();
    fireEvent.change(screen.getByLabelText("Pick a color for Comments"), { target: { value: "#00aa00" } });
    fireEvent.click(screen.getByTestId("settings-editor-colors-mode-dark"));
    fireEvent.change(screen.getByLabelText("Pick a color for Comments"), { target: { value: "#aa0000" } });

    expect(useSettingsStore.getState().editorColors).toEqual({
      "system-light": { comment: "#00aa00" },
      "system-dark": { comment: "#aa0000" },
    });
  });
});

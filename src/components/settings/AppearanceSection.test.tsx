// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENTS,
  DEFAULT_HIDDEN_FILE_PATTERNS,
  useSettingsStore,
} from "@/store/settings";

const toggleTheme = vi.hoisted(() => vi.fn());

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme,
  }),
}));

import { AppearanceSection } from "./AppearanceSection";

describe("Appearance settings tabs", () => {
  beforeEach(() => {
    toggleTheme.mockClear();
    useSettingsStore.setState({
      dockPlacement: "left",
      bgPattern: "dots",
      accentColor: ACCENTS[0].color,
      vim: false,
      editorAutocomplete: false,
      editorAutoCloseBrackets: false,
      editorGhostCompletion: false,
      editorNonBlinkingCursor: false,
      editorStickyScroll: false,
      hiddenFilePatterns: [...DEFAULT_HIDDEN_FILE_PATTERNS],
      openInTree: false,
      pdfDarkMode: false,
      pdfZoomShortcuts: false,
      pdfScreenReaderMode: false,
      hoverPreview: false,
    });
  });

  it("groups editor, PDF preview, and file management settings", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    expect(screen.getByRole("tab", { name: "App" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Editor" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "PDF Preview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Project" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "PDF Preview" }));
    expect(screen.getByRole("switch", { name: "PDF dark mode" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "PDF zoom shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Screen reader mode" })).toBeInTheDocument();

    for (const label of [
      "PDF dark mode",
      "PDF zoom shortcuts",
      "Screen reader mode",
      "Preview PDF on hover",
    ]) {
      await user.click(screen.getByRole("switch", { name: label }));
    }
    expect(useSettingsStore.getState()).toMatchObject({
      pdfDarkMode: true,
      pdfZoomShortcuts: true,
      pdfScreenReaderMode: true,
      hoverPreview: true,
    });
  });

  it("updates the app and editor appearance controls", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    await user.click(screen.getByTestId("settings-dock-placement-right"));
    await user.click(screen.getByTestId("settings-bg-pattern-grid"));
    await user.click(
      screen.getByRole("button", { name: `${ACCENTS[1].name} accent` }),
    );
    await user.click(screen.getByRole("switch", { name: "Dark mode" }));

    expect(useSettingsStore.getState()).toMatchObject({
      dockPlacement: "right",
      bgPattern: "grid",
      accentColor: ACCENTS[1].color,
    });
    expect(toggleTheme).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("tab", { name: "Editor" }));
    for (const label of [
      "Vim mode",
      "Auto-complete",
      "Auto-close brackets",
      "Inline suggestion",
      "Non-blinking cursor",
      "Sticky scroll",
    ]) {
      await user.click(screen.getByRole("switch", { name: label }));
    }
    expect(useSettingsStore.getState()).toMatchObject({
      vim: true,
      editorAutocomplete: true,
      editorAutoCloseBrackets: true,
      editorGhostCompletion: true,
      editorNonBlinkingCursor: true,
      editorStickyScroll: true,
    });
  });

  it("uses the shared file-management controls to add and remove patterns", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Project" }));

    await user.click(screen.getByRole("switch", { name: "Show file tree on open" }));
    expect(useSettingsStore.getState().openInTree).toBe(true);

    expect(screen.getByText("*.aux")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("File name or pattern to hide"), {
      target: { value: "*.generated.tex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add hidden file pattern" }));
    expect(screen.getByText("*.generated.tex")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove *.generated.tex from hidden files",
      }),
    );
    expect(screen.queryByText("*.generated.tex")).not.toBeInTheDocument();

    const patternInput = screen.getByLabelText("File name or pattern to hide");
    fireEvent.change(patternInput, { target: { value: "   " } });
    const patternForm = patternInput.closest("form");
    expect(patternForm).not.toBeNull();
    if (!patternForm) throw new Error("hidden-file form is unavailable");
    fireEvent.submit(patternForm);
    expect(useSettingsStore.getState().hiddenFilePatterns).toEqual(
      DEFAULT_HIDDEN_FILE_PATTERNS,
    );
  });
});

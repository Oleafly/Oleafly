// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HIDDEN_FILE_PATTERNS,
  useSettingsStore,
} from "@/store/settings";

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

import { AppearanceSection } from "./AppearanceSection";

describe("Appearance settings tabs", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      hiddenFilePatterns: [...DEFAULT_HIDDEN_FILE_PATTERNS],
      pdfDarkMode: false,
      pdfZoomShortcuts: true,
      pdfScreenReaderMode: false,
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
  });

  it("uses the shared file-management controls to add and remove patterns", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Project" }));

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
  });
});

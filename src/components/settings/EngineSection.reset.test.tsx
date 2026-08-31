// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineInfo } from "@/lib/tauri";
import { useEngineStore } from "@/store/engine";
import { useSettingsStore } from "@/store/settings";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

import { EngineSection } from "./EngineSection";

const engineInfo: EngineInfo = {
  kind: "tinytex",
  lualatex: "/test/tinytex/bin/lualatex",
  tlmgr: "/test/tinytex/bin/tlmgr",
  version: "TeX Live test",
  latexmk: "/test/tinytex/bin/latexmk",
};

describe("LaTeX Engine reset", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().setDefaultLatexEngine("tectonic");
    useSettingsStore.getState().setAccentColor("#db2777");
    useEngineStore.setState({
      info: engineInfo,
      installed: ["biblatex", "fontspec"],
      loaded: true,
      partialDownloadBytes: 42_000,
    });
  });

  it("resets only the default engine after confirmation and preserves installed engine state", () => {
    useSettingsStore.getState().setDefaultLatexEngine("latexmk");

    render(<EngineSection />);

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    const confirmation = screen.getByRole("alertdialog", {
      name: /Reset LaTeX Engine settings/u,
    });
    expect(confirmation).toHaveTextContent(
      "Restore LaTeX Engine preferences to their defaults.",
    );
    expect(useSettingsStore.getState().defaultLatexEngine).toBe("latexmk");

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Reset to defaults" }),
    );

    expect(useSettingsStore.getState().defaultLatexEngine).toBe("tectonic");
    expect(localStorage.getItem("oleafly.defaultLatexEngine")).toBe("tectonic");
    expect(useEngineStore.getState()).toMatchObject({
      info: engineInfo,
      installed: ["biblatex", "fontspec"],
      loaded: true,
      partialDownloadBytes: 42_000,
    });
    expect(useSettingsStore.getState().accentColor).toBe("#db2777");
    expect(localStorage.getItem("oleafly.accent")).toBe("#db2777");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

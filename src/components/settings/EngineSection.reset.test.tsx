// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { EngineInfo } from "@/lib/tauri";
import { useEngineStore } from "@/store/engine";
import { useSettingsStore } from "@/store/settings";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@/lib/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/theme")>()),
  useTheme: () => ({
    preference: "system",
    theme: "dark",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

import { ChangedSettingsProvider } from "./changed-settings";
import { EngineSection } from "./EngineSection";

const engineInfo: EngineInfo = {
  kind: "tinytex",
  lualatex: "/test/tinytex/bin/lualatex",
  tlmgr: "/test/tinytex/bin/tlmgr",
  version: "TeX Live test",
  latexmk: "/test/tinytex/bin/latexmk",
};

describe("Engines reset", () => {
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

    fireEvent.click(screen.getByRole("button", { name: enSettings.reset.button }));

    const confirmation = screen.getByRole("alertdialog", {
      name: enSettings.reset.confirmTitle.replace(
        "{{sectionName}}",
        enSettings.engine.sectionName,
      ),
    });
    expect(confirmation).toHaveTextContent(
      enSettings.reset.confirmDescription.replace(
        "{{sectionName}}",
        enSettings.engine.sectionName,
      ),
    );
    expect(useSettingsStore.getState().defaultLatexEngine).toBe("latexmk");

    fireEvent.click(
      within(confirmation).getByRole("button", { name: enSettings.reset.button }),
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

  it("puts the default engine Reset at the right edge of its header", () => {
    useSettingsStore.getState().setDefaultLatexEngine("latexmk");
    render(
      <ChangedSettingsProvider>
        <EngineSection />
      </ChangedSettingsProvider>,
    );
    const heading = enSettings.engine.defaultEngine.heading;
    const reset = screen.getByRole("button", {
      name: enSettings.changed.reset.replace("{{label}}", heading),
    });
    const header = screen.getByRole("heading", {
      name: `${heading} ${enSettings.changed.marker}`,
    }).parentElement;
    if (!header) throw new Error("default engine header is missing");

    const item = [...header.children].find((child) => child.contains(reset));
    expect(item).toHaveClass("ml-auto");
  });
});

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { ConfigPreferences } from "@/lib/settings-file/schema";
import { readLocalSnapshot } from "@/lib/settings-file/transfer";
import { useSettingsStore } from "@/store/settings";
import { readCloudSettings, withoutLocalOnlySettings } from "./cloud-settings";

describe("settings that stay on each computer", () => {
  it("returns a document without them unchanged", () => {
    const document = { experimentation: { latexTools: true } };
    expect(withoutLocalOnlySettings(document)).toBe(document);
  });

  it("keeps the default LaTeX engine on each computer, since latexmk needs TeX installed there", () => {
    expect(
      withoutLocalOnlySettings({
        engine: { defaultLatexEngine: "latexmk" },
        experimentation: { latexTools: true },
      }),
    ).toEqual({ experimentation: { latexTools: true } });
    useSettingsStore.setState({ defaultLatexEngine: "tectonic", latexTools: false });
    const read = readCloudSettings(
      { engine: { defaultLatexEngine: "latexmk" }, experimentation: { latexTools: true } },
      readLocalSnapshot(null, "system"),
    );
    if (!read.ok) throw new Error("expected readable settings");
    expect(read.changed).toEqual(["experimentation.latexTools"]);
  });

  it("applies a 0.4.7 cloud document and drops its browser keys", () => {
    useSettingsStore.setState({ latexTools: false });
    const read = readCloudSettings(
      {
        experimentation: { webBrowser: true, latexTools: true },
        appearance: { browser: { homePage: "https://x.org/" } },
      },
      readLocalSnapshot(null, "system"),
    );
    if (!read.ok) throw new Error("expected readable settings");
    expect(read.changed).toEqual(["experimentation.latexTools"]);
    expect(read.ignored).toEqual([]);
  });

  it("keeps the shell choice on this computer", () => {
    expect(
      withoutLocalOnlySettings({
        appearance: { terminal: { shell: "wsl", shellPath: "C:\\x.exe", fontSize: 14 } },
      }),
    ).toEqual({ appearance: { terminal: { fontSize: 14 } } });
    expect(
      withoutLocalOnlySettings({
        general: { language: "fr" },
        appearance: { terminal: { shell: "wsl", shellPath: "C:\\x.exe" } },
      }),
    ).toEqual({ general: { language: "fr" } });
    const document = { appearance: { terminal: { fontSize: 14 } } };
    expect(withoutLocalOnlySettings(document)).toBe(document);
  });

  it("keeps the network choice for task commands on this computer", () => {
    expect(
      withoutLocalOnlySettings({ research: { keepAwake: false, commandNetwork: true, timeBudgetMinutes: 240 } }),
    ).toEqual({ research: { keepAwake: false, timeBudgetMinutes: 240 } });
    expect(withoutLocalOnlySettings({ general: { language: "fr" }, research: { commandNetwork: true } })).toEqual({
      general: { language: "fr" },
    });
  });

  it("never applies a network choice synced from another computer", () => {
    const local = {
      ai_system_prompt: "",
      ai_pdf_capture: true,
      ai_personas: [],
      ai_reasoning_summaries: false,
      checkpoints_enabled: true,
      checkpoint_notifications: true,
      research_keep_awake: true,
      research_notifications: true,
      research_command_network: false,
      research_time_budget_minutes: 120,
    } as unknown as ConfigPreferences;
    const read = readCloudSettings(
      { research: { commandNetwork: true, timeBudgetMinutes: 240 } },
      readLocalSnapshot(local, "system"),
    );
    if (!read.ok) throw new Error("expected readable settings");
    // The time budget syncs; the network choice stays as this computer has it.
    expect(read.changed).toEqual(["research.timeBudgetMinutes"]);
  });

  it("never applies a shell synced from another computer", () => {
    useSettingsStore.setState({ terminalShell: "auto", terminalShellPath: "", terminalScrollback: 5000 });
    const read = readCloudSettings(
      { appearance: { terminal: { shell: "wsl", shellPath: "C:\\x.exe", scrollback: 10000 } } },
      readLocalSnapshot(null, "system"),
    );
    if (!read.ok) throw new Error("expected readable settings");
    expect(read.changed).toEqual(["appearance.terminal.scrollback"]);
  });
});

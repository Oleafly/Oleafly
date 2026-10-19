// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { readLocalSnapshot } from "@/lib/settings-file/transfer";
import { useSettingsStore } from "@/store/settings";
import { readCloudSettings, withoutLocalOnlySettings } from "./cloud-settings";

describe("settings that stay on each computer", () => {
  it("returns a document without them unchanged", () => {
    const document = { experimentation: { latexTools: true } };
    expect(withoutLocalOnlySettings(document)).toBe(document);
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

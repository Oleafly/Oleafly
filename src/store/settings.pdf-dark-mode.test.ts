// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { followPdfDarkModeInOtherWindows, useSettingsStore } from "./settings";

const KEY = "oleafly.pdf.darkMode";

async function reload(stored: string | null) {
  localStorage.clear();
  if (stored !== null) localStorage.setItem(KEY, stored);
  vi.resetModules();
  return (await import("./settings")).useSettingsStore.getState().pdfDarkMode;
}

function changeElsewhere(key: string | null, value: string | null) {
  if (key === null) localStorage.clear();
  else if (value !== null) localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
  return useSettingsStore.getState().pdfDarkMode;
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().setPdfDarkMode("off");
});

describe("PDF dark mode setting", () => {
  it("saves each mode in a form older versions still read", () => {
    const saved = (["follow", "on", "off"] as const).map((mode) => {
      useSettingsStore.getState().setPdfDarkMode(mode);
      return [useSettingsStore.getState().pdfDarkMode, localStorage.getItem(KEY)];
    });
    expect(saved).toEqual([
      ["follow", "follow"],
      ["on", "1"],
      ["off", "0"],
    ]);
  });

  it("reads the old switch values and reset defaults after a restart", async () => {
    const restarted = [];
    for (const stored of [null, "1", "0", "on", "off", "follow", "sometimes"]) restarted.push(await reload(stored));
    expect(restarted).toEqual(["off", "on", "off", "on", "off", "follow", "off"]);
  });

  it("takes the mode another window picked while something shows it, and ignores other keys", () => {
    expect(changeElsewhere(KEY, "follow")).toBe("off");

    const stop = followPdfDarkModeInOtherWindows();
    expect(useSettingsStore.getState().pdfDarkMode).toBe("follow");
    expect([changeElsewhere(KEY, "1"), changeElsewhere(null, null), changeElsewhere(KEY, "follow")]).toEqual([
      "on",
      "off",
      "follow",
    ]);
    expect(changeElsewhere("oleafly.theme", "dark")).toBe("follow");

    stop();
    expect(changeElsewhere(KEY, "1")).toBe("follow");
  });
});

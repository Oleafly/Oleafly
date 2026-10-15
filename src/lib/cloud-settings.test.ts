// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { readLocalSnapshot } from "@/lib/settings-file/transfer";
import { useSettingsStore } from "@/store/settings";
import { readCloudSettings, withoutLocalOnlySettings } from "./cloud-settings";

describe("settings that stay on each computer", () => {
  it("leaves out AI computer use and keeps the other experiments", () => {
    expect(
      withoutLocalOnlySettings({
        general: { language: "fr" },
        experimentation: { webBrowser: true, latexTools: false },
      }),
    ).toEqual({ general: { language: "fr" }, experimentation: { latexTools: false } });
  });

  it("drops the experiments group when only computer-specific switches were in it", () => {
    expect(withoutLocalOnlySettings({ experimentation: { webBrowser: true } })).toEqual({});
  });

  it("returns a document without them unchanged", () => {
    const document = { experimentation: { latexTools: true } };
    expect(withoutLocalOnlySettings(document)).toBe(document);
  });

  it("never applies AI computer use from Dropbox", () => {
    useSettingsStore.setState({ webBrowser: false, latexTools: false });
    const read = readCloudSettings(
      { experimentation: { webBrowser: true, latexTools: true } },
      readLocalSnapshot(null, "system"),
    );
    if (!read.ok) throw new Error("expected readable settings");
    expect(read.changed).toEqual(["experimentation.latexTools"]);
  });
});

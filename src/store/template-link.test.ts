import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { isTemplateLink, openTemplateLink, takeTemplateLink, useTemplateLinkStore } from "./template-link";

beforeEach(() => {
  useTemplateLinkStore.setState({ pending: null, serial: 0 });
  useSettingsStore.setState({
    settingsOpen: false,
    newProjectOpen: true,
    settingsInitialSection: "general",
  });
});

describe("template links", () => {
  it("accepts only two plain ids", () => {
    expect(isTemplateLink({ packId: "open-letter", templateId: "tpl_1" })).toBe(true);
    expect(isTemplateLink({ packId: "a".repeat(128), templateId: "b" })).toBe(true);
    for (const value of [
      null,
      undefined,
      "oleafly://template/a/b",
      { packId: "a" },
      { packId: "", templateId: "b" },
      { packId: "a", templateId: 7 },
      { packId: "../a", templateId: "b" },
      { packId: "a/b", templateId: "c" },
      { packId: "a", templateId: "b c" },
      { packId: "a", templateId: "café" },
      { packId: "a".repeat(129), templateId: "b" },
      { packId: "a\n", templateId: "b" },
    ]) {
      expect(isTemplateLink(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("opens Settings on Downloads with the link waiting and closes New Project", () => {
    openTemplateLink({ packId: "open-letter", templateId: "tpl-1" });
    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      newProjectOpen: false,
      settingsInitialSection: "downloads",
    });
    expect(useTemplateLinkStore.getState()).toEqual({
      serial: 1,
      pending: { packId: "open-letter", templateId: "tpl-1", serial: 1 },
    });
  });

  it("ignores a malformed payload without touching Settings", () => {
    openTemplateLink({ packId: "open-letter", templateId: "../../etc" });
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: false, newProjectOpen: true });
    expect(useTemplateLinkStore.getState()).toEqual({ serial: 0, pending: null });
  });

  it("hands each link over once and keeps counting", () => {
    openTemplateLink({ packId: "a", templateId: "first" });
    openTemplateLink({ packId: "a", templateId: "second" });
    expect(takeTemplateLink()).toEqual({ packId: "a", templateId: "second", serial: 2 });
    expect(takeTemplateLink()).toBeNull();
    expect(useTemplateLinkStore.getState().serial).toBe(2);
  });
});

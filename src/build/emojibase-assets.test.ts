import { existsSync } from "node:fs";
import path from "node:path";
import { SUPPORTED_LOCALES } from "@oleafly/i18n-contract";
import { describe, expect, it } from "vitest";
import { EMOJIBASE_LOCALES, EMOJIBASE_PATH, emojibaseLocale } from "../components/notes/emoji-locale";
import { EMOJIBASE_DATA_DIR, emojibaseAssetFiles, trimEmojiData, trimEmojiMessages } from "./emojibase-assets";

describe("emoji data for the icon picker", () => {
  it("maps every app language to emoji data that ships", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const target = emojibaseLocale(locale);
      expect(EMOJIBASE_LOCALES, locale).toContain(target);
      expect(existsSync(path.join(EMOJIBASE_DATA_DIR, target, "data.json")), locale).toBe(true);
    }
  });

  it("falls back to English for languages emojibase does not cover", () => {
    expect(emojibaseLocale("tr")).toBe("en");
    expect(emojibaseLocale("zh-Hans")).toBe("zh");
    expect(emojibaseLocale("zh-Hant")).toBe("zh-hant");
    expect(emojibaseLocale("pt-BR")).toBe("pt");
  });

  it("emits a data and a messages file for each shipped language", () => {
    const files = emojibaseAssetFiles();
    expect(files.size).toBe(EMOJIBASE_LOCALES.length * 2);
    expect(files.has(`${EMOJIBASE_PATH}/en/data.json`)).toBe(true);
    expect(files.has(`${EMOJIBASE_PATH}/en/messages.json`)).toBe(true);
  });

  it("keeps only the fields the picker reads", () => {
    const [emoji] = trimEmojiData([
      {
        label: "waving hand",
        emoji: "👋",
        group: 1,
        subgroup: 15,
        version: 0.6,
        tags: ["hand", "wave"],
        skins: [{ emoji: "👋🏻", tone: 1 }],
        ...{ hexcode: "1F44B", shortcodes: ["wave"], order: 160, type: 1 },
      },
    ]);
    expect(emoji).toEqual({
      label: "waving hand",
      emoji: "👋",
      group: 1,
      subgroup: 15,
      version: 0.6,
      tags: ["hand", "wave"],
      skins: [{ emoji: "👋🏻", tone: 1 }],
    });
    const messages = trimEmojiMessages({
      groups: [{ key: "smileys-emotion", message: "smileys & emotion", order: 0 }],
      subgroups: [{ key: "country-flag", message: "country flag", order: 95 }],
      skinTones: [{ key: "light", message: "light skin tone", order: 1 }],
    });
    expect(messages).toEqual({
      groups: [{ key: "smileys-emotion", message: "smileys & emotion", order: 0 }],
      subgroups: [{ key: "country-flag", order: 95 }],
      skinTones: [{ key: "light", message: "light skin tone" }],
    });
  });

  it("produces data the picker can parse for every shipped language", () => {
    for (const [name, build] of emojibaseAssetFiles()) {
      const parsed: unknown = JSON.parse(build());
      if (name.endsWith("/data.json")) {
        expect(Array.isArray(parsed), name).toBe(true);
        const emojis = parsed as { label: unknown; emoji: unknown; version: unknown }[];
        expect(emojis.length, name).toBeGreaterThan(1000);
        expect(emojis.every((entry) => typeof entry.label === "string" && typeof entry.emoji === "string"), name).toBe(true);
      } else {
        expect(parsed, name).toMatchObject({ groups: expect.any(Array), subgroups: expect.any(Array), skinTones: expect.any(Array) });
      }
    }
  });
});

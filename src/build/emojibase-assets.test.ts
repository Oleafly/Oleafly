import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SUPPORTED_LOCALES } from "@oleafly/i18n-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EMOJIBASE_LOCALES, EMOJIBASE_PATH, emojibaseLocale } from "../components/notes/emoji-locale";
import {
  EMOJIBASE_DATA_DIR,
  emojibaseAssetFiles,
  emojibaseAssets,
  trimEmojiData,
  trimEmojiMessages,
} from "./emojibase-assets";

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

type Request = { url?: string; method?: string };
type Response = { setHeader: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
type Middleware = (request: Request, response: Response, next: () => void) => void;
type ConfigureServerHook = (server: { config: { base: string }; middlewares: { use: (fn: Middleware) => void } }) => void;
type EmitFile = (file: { type: "asset"; fileName: string; source: string }) => string;
type GenerateBundleHook = (this: { emitFile: EmitFile }, options: unknown, bundle: Record<string, unknown>) => void;

const SAMPLE = [{ label: "grinning face", emoji: "😀", group: 0, subgroup: 1, version: 1, hexcode: "1F600" }];
const MESSAGES = {
  groups: [{ key: "smileys-emotion", message: "smileys & emotion", order: 0 }],
  subgroups: [{ key: "face-smiling", message: "face smiling", order: 0 }],
  skinTones: [{ key: "light", message: "light skin tone", order: 1 }],
};

let dataDir = "";

function writeLocale(locale: string, emojis: unknown) {
  const folder = path.join(dataDir, locale);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "data.json"), JSON.stringify(emojis));
  writeFileSync(path.join(folder, "messages.json"), JSON.stringify(MESSAGES));
}

function serve(base: string) {
  let handler: Middleware | null = null;
  const plugin = emojibaseAssets(dataDir);
  (plugin.configureServer as unknown as ConfigureServerHook)({
    config: { base },
    middlewares: {
      use: (fn) => {
        handler = fn;
      },
    },
  });
  return (request: Request) => {
    const response: Response = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    if (!handler) throw new Error("the plugin registered no middleware");
    handler(request, response, next);
    return { response, next };
  };
}

describe("emoji data served by the app", () => {
  beforeAll(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "emojibase-assets-"));
    for (const locale of EMOJIBASE_LOCALES) writeLocale(locale, SAMPLE);
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("serves trimmed emoji data as JSON and ignores the query string", () => {
    const request = serve("/");
    const { response, next } = request({ url: `/${EMOJIBASE_PATH}/en/data.json?v=3`, method: "GET" });
    expect(next).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
    expect(JSON.parse(response.end.mock.calls[0][0] as string)).toEqual([
      { label: "grinning face", emoji: "😀", group: 0, subgroup: 1, version: 1 },
    ]);
  });

  it("serves the messages file under a base path", () => {
    const request = serve("/app/");
    const { response, next } = request({ url: `/app/${EMOJIBASE_PATH}/fr/messages.json`, method: "GET" });
    expect(next).not.toHaveBeenCalled();
    expect(JSON.parse(response.end.mock.calls[0][0] as string)).toEqual(trimEmojiMessages(MESSAGES));
  });

  it("answers a HEAD request with headers and no body", () => {
    const request = serve("/");
    const { response, next } = request({ url: `/${EMOJIBASE_PATH}/de/data.json`, method: "HEAD" });
    expect(next).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
    expect(response.end).toHaveBeenCalledWith(undefined);
  });

  it.each([
    ["a path outside the base", "/app/", `/${EMOJIBASE_PATH}/en/data.json`],
    ["a language that does not ship", "/", `/${EMOJIBASE_PATH}/xx/data.json`],
    ["another file", "/", "/src/main.tsx"],
    ["a request without a URL", "/", undefined],
  ])("passes %s on to the next handler", (_name, base, url) => {
    const request = serve(base);
    const { response, next } = request({ url, method: "GET" });
    expect(next).toHaveBeenCalledOnce();
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });

  it("builds each file once and answers later requests from memory", () => {
    writeLocale("ja", SAMPLE);
    const request = serve("/");
    const first = request({ url: `/${EMOJIBASE_PATH}/ja/data.json`, method: "GET" });
    writeLocale("ja", [{ ...SAMPLE[0], label: "changed on disk" }]);
    const second = request({ url: `/${EMOJIBASE_PATH}/ja/data.json`, method: "GET" });
    expect(second.response.end.mock.calls[0][0]).toBe(first.response.end.mock.calls[0][0]);
    expect(JSON.parse(second.response.end.mock.calls[0][0] as string)[0].label).toBe("grinning face");
    writeLocale("ja", SAMPLE);
  });

  it("emits every data and messages file into the build", () => {
    const emitFile = vi.fn<EmitFile>(() => "");
    const plugin = emojibaseAssets(dataDir);
    (plugin.generateBundle as unknown as GenerateBundleHook).call({ emitFile }, {}, {});
    expect(emitFile).toHaveBeenCalledTimes(EMOJIBASE_LOCALES.length * 2);
    expect(emitFile).toHaveBeenCalledWith({
      type: "asset",
      fileName: `${EMOJIBASE_PATH}/ko/data.json`,
      source: JSON.stringify(trimEmojiData(SAMPLE)),
    });
    expect(emitFile).toHaveBeenCalledWith({
      type: "asset",
      fileName: `${EMOJIBASE_PATH}/ko/messages.json`,
      source: JSON.stringify(trimEmojiMessages(MESSAGES)),
    });
  });

  it("uses the installed emojibase data when no folder is given", () => {
    expect(emojibaseAssets().name).toBe("emojibase-assets");
  });
});

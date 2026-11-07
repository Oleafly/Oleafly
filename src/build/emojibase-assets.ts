import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import { EMOJIBASE_LOCALES, EMOJIBASE_PATH } from "../components/notes/emoji-locale";

interface EmojibaseSkin {
  emoji: string;
  tone?: number | number[];
}

interface EmojibaseEmoji {
  label: string;
  emoji: string;
  group?: number;
  subgroup?: number;
  version: number;
  tags?: string[];
  skins?: EmojibaseSkin[];
}

interface EmojibaseMessage {
  key: string;
  message?: string;
  order?: number;
}

interface EmojibaseMessages {
  groups: EmojibaseMessage[];
  subgroups: EmojibaseMessage[];
  skinTones: EmojibaseMessage[];
}

export const EMOJIBASE_DATA_DIR = path.dirname(createRequire(import.meta.url).resolve("emojibase-data/package.json"));

export function trimEmojiData(emojis: readonly EmojibaseEmoji[]): EmojibaseEmoji[] {
  return emojis.map((emoji) => ({
    label: emoji.label,
    emoji: emoji.emoji,
    ...(emoji.group === undefined ? {} : { group: emoji.group }),
    ...(emoji.subgroup === undefined ? {} : { subgroup: emoji.subgroup }),
    version: emoji.version,
    ...(emoji.tags ? { tags: emoji.tags } : {}),
    ...(emoji.skins ? { skins: emoji.skins.map(({ emoji: skin, tone }) => ({ emoji: skin, tone })) } : {}),
  }));
}

export function trimEmojiMessages(messages: EmojibaseMessages): EmojibaseMessages {
  return {
    groups: messages.groups.map(({ key, message, order }) => ({ key, message, order })),
    subgroups: messages.subgroups.map(({ key, order }) => ({ key, order })),
    skinTones: messages.skinTones.map(({ key, message }) => ({ key, message })),
  };
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function emojibaseAssetFiles(dataDir = EMOJIBASE_DATA_DIR): Map<string, () => string> {
  const files = new Map<string, () => string>();
  for (const locale of EMOJIBASE_LOCALES) {
    const folder = path.join(dataDir, locale);
    files.set(`${EMOJIBASE_PATH}/${locale}/data.json`, () =>
      JSON.stringify(trimEmojiData(readJson<EmojibaseEmoji[]>(path.join(folder, "data.json")))),
    );
    files.set(`${EMOJIBASE_PATH}/${locale}/messages.json`, () =>
      JSON.stringify(trimEmojiMessages(readJson<EmojibaseMessages>(path.join(folder, "messages.json")))),
    );
  }
  return files;
}

export const emojibaseAssets = (dataDir = EMOJIBASE_DATA_DIR): Plugin => ({
  name: "emojibase-assets",
  configureServer(server) {
    const base = server.config.base;
    const files = emojibaseAssetFiles(dataDir);
    const cache = new Map<string, string>();
    server.middlewares.use((request, response, next) => {
      const url = request.url?.split("?")[0] ?? "";
      const name = url.startsWith(base) ? url.slice(base.length) : "";
      const build = files.get(name);
      if (!build) return next();
      const body = cache.get(name) ?? build();
      cache.set(name, body);
      response.setHeader("Content-Type", "application/json");
      response.end(request.method === "HEAD" ? undefined : body);
    });
  },
  generateBundle() {
    for (const [fileName, build] of emojibaseAssetFiles(dataDir)) {
      this.emitFile({ type: "asset", fileName, source: build() });
    }
  },
});

const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:/iu;

export const NOTE_FILE_MAX_BYTES = 64 * 1024 * 1024;

export function imageSource(src: string): { url: string } | { path: string } | null {
  const value = src.trim();
  if (value === "") return null;
  if (/^(?:https:|data:image\/)/iu.test(value)) return { url: value };
  if (ABSOLUTE_URL.test(value) || value.startsWith("/") || value.startsWith("\\")) return null;
  let path = value;
  try {
    path = decodeURI(value);
  } catch {
    path = value;
  }
  const clean = path.replace(/^\.\//u, "");
  return clean.split(/[\\/]/u).includes("..") ? null : { path: clean };
}

export function notePath(src: string): string | null {
  const source = imageSource(src);
  return source && "path" in source ? source.path : null;
}

const MEDIA_TYPES = {
  audio: { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac" },
  video: { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg" },
  pdf: { pdf: "application/pdf" },
} as const;

export type NoteMediaKind = keyof typeof MEDIA_TYPES;

export const NOTE_MEDIA_EXTENSIONS: Readonly<Record<NoteMediaKind, readonly string[]>> = {
  audio: Object.keys(MEDIA_TYPES.audio),
  video: Object.keys(MEDIA_TYPES.video),
  pdf: Object.keys(MEDIA_TYPES.pdf),
};

export function assetFragment(path: string): { file: string; page: number | null } {
  const hash = path.indexOf("#");
  if (hash < 0) return { file: path, page: null };
  const page = /^page=([1-9]\d{0,4})$/u.exec(path.slice(hash + 1));
  return { file: path.slice(0, hash), page: page ? Number(page[1]) : null };
}

function extensionOf(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot < 0 ? "" : file.slice(dot + 1).toLowerCase();
}

export function noteMediaKind(src: string): NoteMediaKind | null {
  const path = notePath(src);
  if (!path) return null;
  const extension = extensionOf(assetFragment(path).file);
  const found = (Object.keys(MEDIA_TYPES) as NoteMediaKind[]).find((kind) => Object.hasOwn(MEDIA_TYPES[kind], extension));
  return found ?? null;
}

export function noteMediaType(file: string): string {
  const extension = extensionOf(file);
  for (const types of Object.values(MEDIA_TYPES)) {
    if (Object.hasOwn(types, extension)) return types[extension as keyof typeof types];
  }
  return "application/octet-stream";
}

export function noteMediaExtension(type: string): string | null {
  const wanted = type.split(";")[0].trim().toLowerCase();
  if (wanted === "") return null;
  for (const types of Object.values(MEDIA_TYPES)) {
    const found = Object.entries(types).find(([, mime]) => mime === wanted);
    if (found) return found[0];
  }
  return null;
}

export function playsInNote(src: string): boolean {
  const kind = noteMediaKind(src);
  return kind === "audio" || kind === "video" || videoEmbed(src) !== null;
}

export type VideoProvider = "youtube" | "vimeo";

export interface VideoEmbed {
  provider: VideoProvider;
  id: string;
  start: number | null;
  hash: string | null;
  frame: string;
  page: string;
  thumbnail: string | null;
}

export function videoFramePage(embed: VideoEmbed, origin: string): string {
  const query = [embed.start ? `start=${embed.start}` : "", embed.hash ? `h=${embed.hash}` : ""].filter(Boolean).join("&");
  const search = query ? `?${query}` : "";
  return `${origin}/video#${embed.provider}/${embed.id}${search}`;
}

export const VIDEO_PROVIDER_NAMES: Readonly<Record<VideoProvider, string>> = { youtube: "YouTube", vimeo: "Vimeo" };

const YOUTUBE_ID = /^[\w-]{11}$/u;
const YOUTUBE_PATHS = new Set(["embed", "shorts", "live"]);
const VIMEO_HASH = /^[\da-f]{6,}$/u;

function vimeoHash(value: string | null | undefined): string | null {
  return value && VIMEO_HASH.test(value) ? value : null;
}

function startSeconds(value: string | null): number | null {
  const match = value ? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/u.exec(value) : null;
  if (!match) return null;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return total > 0 ? total : null;
}

function youtubeId(url: URL, host: string): string | null {
  if (host === "youtu.be") return url.pathname.slice(1);
  const [first, second] = url.pathname.split("/").filter(Boolean);
  if (first === "watch") return url.searchParams.get("v");
  return first && YOUTUBE_PATHS.has(first) ? (second ?? null) : null;
}

export function videoEmbed(src: string): VideoEmbed | null {
  let url: URL;
  try {
    url = new URL(src.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/u, "");
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    const id = youtubeId(url, host);
    if (!id || !YOUTUBE_ID.test(id)) return null;
    const start = startSeconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
    const frameStart = start ? `?start=${start}` : "";
    const pageStart = start ? `&t=${start}` : "";
    return {
      provider: "youtube",
      id,
      start,
      hash: null,
      frame: `https://www.youtube-nocookie.com/embed/${id}${frameStart}`,
      page: `https://www.youtube.com/watch?v=${id}${pageStart}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const at = parts.findIndex((part) => /^\d{5,12}$/u.test(part));
  if (at < 0) return null;
  const hash = vimeoHash(url.searchParams.get("h")) ?? vimeoHash(parts[at + 1]);
  const frameHash = hash ? `&h=${hash}` : "";
  const pageHash = hash ? `/${hash}` : "";
  return {
    provider: "vimeo",
    id: parts[at],
    start: null,
    hash,
    frame: `https://player.vimeo.com/video/${parts[at]}?dnt=1${frameHash}`,
    page: `https://vimeo.com/${parts[at]}${pageHash}`,
    thumbnail: null,
  };
}

import { Globe } from "lucide-react";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { BLOCK_CARD } from "@/components/ui/block-frame";
import { Spinner } from "@/components/ui/spinner";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { remoteImageAllowed, subscribeRemoteImages } from "@/lib/remote-image";
import { openInSystemBrowser, safeHttpUrl } from "@/lib/system-browser";
import { type NoteLinkPreview, noteLinkPreview } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { blockMessage, type Dispose, element, type NoteBlockKind, type PaintContext, splitBlockOptions } from "./note-blocks";
import { nodeRoot } from "./node-root";

export const BOOKMARK_INFO = "bookmark";

const FIELDS = ["url", "title", "description", "image", "site", "favicon"] as const;
type Field = (typeof FIELDS)[number];

type Bookmark = { url: string } & Partial<Record<Exclude<Field, "url">, string>>;

const FIELD_NAMES: ReadonlySet<string> = new Set(FIELDS);

function oneLine(value: string | null | undefined): string {
  return (value ?? "").replaceAll(/\s+/gu, " ").trim();
}

function webAddress(value: string | null | undefined): string {
  const address = oneLine(value);
  return safeHttpUrl(address) ? address : "";
}

export function parseBookmark(source: string): Bookmark | null {
  const { options } = splitBlockOptions(source, FIELD_NAMES);
  const url = webAddress(options.get("url"));
  if (!url) return null;
  const bookmark: Bookmark = { url };
  for (const field of FIELDS) {
    const value = options.get(field);
    if (field !== "url" && value) bookmark[field] = value;
  }
  return bookmark;
}

export function serializeBookmark(bookmark: Bookmark): string {
  return FIELDS.flatMap((field) => {
    const value = oneLine(bookmark[field]);
    return value ? [`${field}: ${value}`] : [];
  }).join("\n");
}

export function bookmarkFromPreview(url: string, preview: NoteLinkPreview): Bookmark {
  return {
    url,
    title: oneLine(preview.title),
    description: oneLine(preview.description),
    image: webAddress(preview.image),
    site: oneLine(preview.siteName),
    favicon: webAddress(preview.favicon),
  };
}

function bookmarkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const loading = new Map<string, number>();
const listeners = new Set<() => void>();

function changeLoading(url: string, step: 1 | -1): void {
  const count = (loading.get(url) ?? 0) + step;
  if (count > 0) loading.set(url, count);
  else loading.delete(url);
  for (const listener of Array.from(listeners)) listener();
}

function subscribeLoading(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadBookmark(url: string, apply: (source: string) => void): Promise<void> {
  changeLoading(url, 1);
  try {
    apply(serializeBookmark(bookmarkFromPreview(url, await noteLinkPreview(url))));
  } catch (error) {
    void logError("load a link preview", error);
  } finally {
    changeLoading(url, -1);
  }
}

function WebImage({ src, className, fallback = null }: Readonly<{ src: string | undefined; className: string; fallback?: ReactNode }>) {
  const allowed = useSyncExternalStore(subscribeRemoteImages, () => (src ? remoteImageAllowed(src) : false));
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || !allowed || failed === src) return fallback;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={className}
    />
  );
}

function BookmarkCard({ bookmark }: Readonly<{ bookmark: Bookmark }>) {
  const { t } = useTranslation(["notes"]);
  const busy = useSyncExternalStore(subscribeLoading, () => loading.has(bookmark.url));
  return (
    <a
      href={bookmark.url}
      data-bookmark
      aria-busy={busy || undefined}
      draggable={false}
      onClick={(event) => {
        event.preventDefault();
        void openInSystemBrowser(bookmark.url);
      }}
      className={cn(
        BLOCK_CARD,
        "flex min-w-0 items-center gap-3 text-foreground no-underline transition-colors hover:bg-muted focus-visible:bg-muted motion-reduce:transition-none",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{bookmark.title ?? bookmark.url}</span>
        {bookmark.description && <span className="line-clamp-2 text-xs text-muted-foreground">{bookmark.description}</span>}
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {busy ? (
            <Spinner size="xs" aria-hidden />
          ) : (
            <WebImage src={bookmark.favicon} className="size-3.5 shrink-0 rounded-sm" fallback={<Globe aria-hidden className="size-3.5 shrink-0" />} />
          )}
          <span className="truncate">{busy ? t(($) => $.notes.blocks.bookmark.loading) : (bookmark.site ?? bookmarkHost(bookmark.url))}</span>
        </span>
      </span>
      <WebImage src={bookmark.image} className="h-16 w-24 shrink-0 rounded object-cover" />
    </a>
  );
}

function paintStill(preview: HTMLElement, bookmark: Bookmark): void {
  const card = element("div", cn(BLOCK_CARD, "min-w-0"));
  card.append(
    element("p", "truncate text-sm text-primary underline underline-offset-2", bookmark.title ?? bookmark.url),
    element("p", "mt-1 truncate text-xs text-muted-foreground", bookmark.site ?? bookmarkHost(bookmark.url)),
  );
  preview.replaceChildren(card);
}

function paintBookmark(preview: HTMLElement, source: string, context: PaintContext): Dispose | undefined {
  const bookmark = parseBookmark(source);
  if (!bookmark) {
    blockMessage(preview, i18n.t(($) => $.notes.blocks.bookmark.noUrl));
    return undefined;
  }
  if (context.still) {
    paintStill(preview, bookmark);
    return undefined;
  }
  const host = element("div", "w-full min-w-0");
  preview.replaceChildren(host);
  const root = nodeRoot(host);
  root.render(<BookmarkCard bookmark={bookmark} />);
  return root.unmount;
}

export const bookmarkBlock: NoteBlockKind = {
  name: BOOKMARK_INFO,
  label: () => i18n.t(($) => $.notes.blocks.bookmark.label),
  icon: Globe,
  paint: paintBookmark,
  interactive: true,
};

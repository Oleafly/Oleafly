import { AtSign, SquareArrowOutUpRight } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { BLOCK_CARD } from "@/components/ui/block-frame";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/empty";
import { i18n } from "@/i18n";
import { logError, logWarning } from "@/lib/log";
import { openInSystemBrowser } from "@/lib/system-browser";
import { type NoteXPost, noteVideoFrameOrigin, noteXPost } from "@/lib/tauri";
import { type Theme, useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import { blockMessage, type Dispose, element, type NoteBlockKind, type PaintContext, splitBlockOptions } from "./note-blocks";
import { nodeRoot } from "./node-root";

export const X_POST_INFO = "x-post";

const FIELDS = ["url", "author", "handle", "date"] as const;
const FIELD_NAMES: ReadonlySet<string> = new Set(FIELDS);
const FRAME_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/u;
const POST_PATH = /^\/(\w{1,15})\/status(?:es)?\/(\d{1,20})(?:\/|$)/u;

export interface XPost {
  url: string;
  id: string;
  author?: string;
  handle?: string;
  date?: string;
  text: string;
}

export function xPostLink(link: string): { url: string; id: string } | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|mobile\.)/u, "");
  if (host !== "x.com" && host !== "twitter.com") return null;
  const match = POST_PATH.exec(url.pathname);
  return match ? { url: `https://x.com/${match[1]}/status/${match[2]}`, id: match[2] } : null;
}

function oneLine(value: string | null | undefined): string {
  return (value ?? "").replaceAll(/\s+/gu, " ").trim();
}

export function parseXPost(source: string): XPost | null {
  const { options, body } = splitBlockOptions(source, FIELD_NAMES);
  const link = xPostLink(options.get("url") ?? "");
  if (!link) return null;
  const post: XPost = { ...link, text: body.trim() };
  for (const field of ["author", "handle", "date"] as const) {
    const value = oneLine(options.get(field));
    if (value) post[field] = value;
  }
  return post;
}

export function serializeXPost(post: Pick<XPost, "url"> & Partial<XPost>): string {
  const lines = FIELDS.flatMap((field) => {
    const value = oneLine(post[field]);
    return value ? [`${field}: ${value}`] : [];
  });
  const text = (post.text ?? "").trim();
  return text ? `${lines.join("\n")}\n\n${text}` : lines.join("\n");
}

export function xPostFromFetch(fetched: NoteXPost): string {
  return serializeXPost({ url: fetched.url, author: fetched.author, handle: fetched.handle, date: fetched.date, text: fetched.text });
}

const loading = new Map<string, number>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function xPostGone(error: unknown): boolean {
  return typeof error === "string" && /^X could not show this post \((?:404|410)\b/u.test(error);
}

export async function loadXPost(url: string, apply: (source: string) => void): Promise<void> {
  loading.set(url, (loading.get(url) ?? 0) + 1);
  failed.delete(url);
  changed();
  try {
    apply(xPostFromFetch(await noteXPost(url)));
  } catch (error) {
    failed.add(url);
    if (xPostGone(error)) void logWarning("load a post from X", error);
    else void logError("load a post from X", error);
  } finally {
    const left = (loading.get(url) ?? 1) - 1;
    if (left > 0) loading.set(url, left);
    else loading.delete(url);
    changed();
  }
}

const LIVE_HEIGHT_MIN = 40;
const LIVE_HEIGHT_MAX = 4000;
const LIVE_SILENCE_MS = 15_000;

type LiveReport = { height: number } | "missing";

function liveReport(data: unknown): LiveReport | null {
  if (typeof data !== "object" || data === null) return null;
  const report = data as { source?: unknown; height?: unknown; missing?: unknown };
  if (report.source !== "oleafly-x-post") return null;
  if (report.missing === true) return "missing";
  if (typeof report.height !== "number" || !Number.isFinite(report.height)) return null;
  return { height: Math.min(LIVE_HEIGHT_MAX, Math.max(LIVE_HEIGHT_MIN, Math.ceil(report.height))) };
}

function LoadingPost() {
  const { t } = useTranslation(["notes"]);
  return <LoadingState size="compact" label={t(($) => $.notes.blocks.xPost.loading)} />;
}

function PostMissing() {
  const { t } = useTranslation(["notes"]);
  return <p className="text-sm text-muted-foreground">{t(($) => $.notes.blocks.xPost.failed)}</p>;
}

function LivePost({ id, theme }: Readonly<{ id: string; theme: Theme }>) {
  const { t } = useTranslation(["notes"]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(noteVideoFrameOrigin)
      .then((found) => {
        if (!live) return;
        if (FRAME_ORIGIN.test(found)) setOrigin(found);
        else throw new Error(`unexpected frame origin ${found}`);
      })
      .catch((error: unknown) => {
        if (live) setUnavailable(true);
        void logError("open a live post from X", error);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!origin) return;
    const silence = window.setTimeout(() => {
      setUnavailable(true);
      void logWarning("show a live post from X", `X sent nothing for post ${id} in ${LIVE_SILENCE_MS / 1000} s`);
    }, LIVE_SILENCE_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frameRef.current?.contentWindow) return;
      const report = liveReport(event.data);
      if (!report) return;
      window.clearTimeout(silence);
      if (report === "missing") {
        setUnavailable(true);
        void logWarning("show a live post from X", `X has no post ${id} to show`);
        return;
      }
      setHeight((current) => (current !== null && Math.abs(current - report.height) < 2 ? current : report.height));
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(silence);
      window.removeEventListener("message", onMessage);
    };
  }, [id, origin]);

  if (unavailable) return <PostMissing />;
  if (!origin) return <LoadingPost />;
  return (
    <iframe
      ref={frameRef}
      title={t(($) => $.notes.blocks.xPost.liveTitle)}
      src={`${origin}/video#x/${id}?theme=${theme}`}
      referrerPolicy="strict-origin-when-cross-origin"
      data-x-post-live
      aria-busy={height === null || undefined}
      style={height === null ? undefined : { height }}
      className={cn("block w-full rounded border-0", height === null && "h-60")}
    />
  );
}

function XPostCard({ post }: Readonly<{ post: XPost }>) {
  const { t } = useTranslation(["notes"]);
  const liveByDefault = useSettingsStore((state) => state.notesXPostsLive);
  const theme = useAppTheme();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const live = chosen ?? liveByDefault;
  const busy = useSyncExternalStore(subscribe, () => loading.has(post.url));
  const missing = useSyncExternalStore(subscribe, () => failed.has(post.url));
  let body = <p className="whitespace-pre-wrap text-sm">{post.text}</p>;
  if (live) body = <LivePost key={theme} id={post.id} theme={theme} />;
  else if (!post.text && busy) body = <LoadingPost />;
  else if (!post.text && missing) body = <PostMissing />;
  else if (!post.text) body = <p className="text-sm text-muted-foreground">{post.url}</p>;
  return (
    <div data-x-post={post.id} aria-busy={busy || undefined} className={cn(BLOCK_CARD, "flex min-w-0 flex-col gap-2")}>
      <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
        <span className="truncate font-medium">{post.author ?? t(($) => $.notes.blocks.xPost.label)}</span>
        {post.handle && <span className="truncate text-muted-foreground">{`@${post.handle}`}</span>}
        {post.date && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{post.date}</span>}
      </div>
      {body}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" aria-pressed={live} onClick={() => setChosen(!live)}>
          <AtSign aria-hidden />
          {live ? t(($) => $.notes.blocks.xPost.showSaved) : t(($) => $.notes.blocks.xPost.showLive)}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => void openInSystemBrowser(post.url)}>
          <SquareArrowOutUpRight aria-hidden />
          {t(($) => $.notes.blocks.xPost.open)}
        </Button>
      </div>
    </div>
  );
}

function paintStill(preview: HTMLElement, post: XPost): void {
  const card = element("div", cn(BLOCK_CARD, "min-w-0"));
  const who = [post.author, post.handle ? `@${post.handle}` : ""].filter(Boolean).join(" ");
  card.append(element("p", "truncate text-sm font-medium", who || post.url), element("p", "mt-1 line-clamp-3 text-sm", post.text));
  preview.replaceChildren(card);
}

function paintXPost(preview: HTMLElement, source: string, context: PaintContext): Dispose | undefined {
  const post = parseXPost(source);
  if (!post) {
    blockMessage(preview, i18n.t(($) => $.notes.blocks.xPost.noUrl));
    return undefined;
  }
  if (context.still) {
    paintStill(preview, post);
    return undefined;
  }
  const host = element("div", "w-full min-w-0");
  preview.replaceChildren(host);
  const root = nodeRoot(host);
  root.render(<XPostCard post={post} />);
  return root.unmount;
}

export const xPostBlock: NoteBlockKind = {
  name: X_POST_INFO,
  label: () => i18n.t(($) => $.notes.blocks.xPost.label),
  icon: AtSign,
  paint: paintXPost,
  interactive: true,
};

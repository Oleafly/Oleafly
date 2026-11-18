import { AtSign, SquareArrowOutUpRight } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { BLOCK_CARD } from "@/components/ui/block-frame";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { openInSystemBrowser } from "@/lib/system-browser";
import { type NoteXPost, noteVideoFrameOrigin, noteXPost } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import { blockMessage, type Dispose, element, type NoteBlockKind, type PaintContext, splitBlockOptions } from "./note-blocks";
import { nodeRoot } from "./node-root";

export const X_POST_INFO = "x-post";

const FIELDS = ["url", "author", "handle", "date"] as const;
const FIELD_NAMES: ReadonlySet<string> = new Set(FIELDS);
const FRAME_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/u;
const POST_PATH = /^\/(\w{1,15})\/status(?:es)?\/(\d{1,20})(?:\/|$)/u;

/** A post on X as a note keeps it: enough to read it offline and in other Markdown apps. */
export interface XPost {
  url: string;
  id: string;
  author?: string;
  handle?: string;
  date?: string;
  text: string;
}

/** The canonical address and id of a post on X or Twitter, or null for any other link. */
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

/** Reads the post from X and hands the block source to `apply`; a failure leaves the link card as it is. */
export async function loadXPost(url: string, apply: (source: string) => void): Promise<void> {
  loading.set(url, (loading.get(url) ?? 0) + 1);
  failed.delete(url);
  changed();
  try {
    apply(xPostFromFetch(await noteXPost(url)));
  } catch (error) {
    failed.add(url);
    void logError("load a post from X", error);
  } finally {
    const left = (loading.get(url) ?? 1) - 1;
    if (left > 0) loading.set(url, left);
    else loading.delete(url);
    changed();
  }
}

function darkTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}

function LivePost({ id }: Readonly<{ id: string }>) {
  const { t } = useTranslation(["notes"]);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(noteVideoFrameOrigin)
      .then((origin) => {
        if (live && FRAME_ORIGIN.test(origin)) setSrc(`${origin}/video#x/${id}?theme=${darkTheme() ? "dark" : "light"}`);
      })
      .catch((error: unknown) => logError("open a live post from X", error));
    return () => {
      live = false;
    };
  }, [id]);
  if (!src) return <Spinner size="sm" aria-hidden />;
  return (
    <iframe
      title={t(($) => $.notes.blocks.xPost.liveTitle)}
      src={src}
      referrerPolicy="strict-origin-when-cross-origin"
      data-x-post-live
      className="h-[34rem] w-full rounded border-0"
    />
  );
}

function XPostCard({ post }: Readonly<{ post: XPost }>) {
  const { t } = useTranslation(["notes"]);
  const liveByDefault = useSettingsStore((state) => state.notesXPostsLive);
  const [live, setLive] = useState(liveByDefault);
  const busy = useSyncExternalStore(subscribe, () => loading.has(post.url));
  const missing = useSyncExternalStore(subscribe, () => failed.has(post.url));
  let body = <p className="whitespace-pre-wrap text-sm">{post.text}</p>;
  if (live) body = <LivePost id={post.id} />;
  else if (!post.text && busy) {
    body = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="xs" aria-hidden />
        {t(($) => $.notes.blocks.xPost.loading)}
      </p>
    );
  } else if (!post.text) {
    body = <p className="text-sm text-muted-foreground">{missing ? t(($) => $.notes.blocks.xPost.failed) : post.url}</p>;
  }
  return (
    <div data-x-post={post.id} aria-busy={busy || undefined} className={cn(BLOCK_CARD, "flex min-w-0 flex-col gap-2")}>
      <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
        <span className="truncate font-medium">{post.author ?? t(($) => $.notes.blocks.xPost.label)}</span>
        {post.handle && <span className="truncate text-muted-foreground">{`@${post.handle}`}</span>}
        {post.date && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{post.date}</span>}
      </div>
      {body}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" aria-pressed={live} onClick={() => setLive((shown) => !shown)}>
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

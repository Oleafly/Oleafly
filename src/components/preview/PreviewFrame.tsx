import { useEffect, useRef, useState } from "react";
import { frameHasUserFocus } from "@/components/notes/artifact-runtime/frame-host";
import { logError } from "@/lib/log";
import { openInSystemBrowser, safeHttpUrl } from "@/lib/system-browser";
import { cn } from "@/lib/utils";

const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads";

export const PREVIEW_LINK_MESSAGE = "oleafly-preview-open-link";
export const PREVIEW_READY_MESSAGE = "oleafly-preview-ready";
export const PREVIEW_APPEARANCE_MESSAGE = "oleafly-preview-appearance";
export const PREVIEW_LOOK_MESSAGE = "oleafly-preview-look";
const LINK_GAP_MS = 1000;

function frameOrigin(src: string): string | null {
  try {
    return new URL(src).origin;
  } catch {
    return null;
  }
}

function messageType(data: unknown): unknown {
  return typeof data === "object" && data !== null ? (data as { type?: unknown }).type : undefined;
}

function clickedLink(data: unknown): string | null {
  if (messageType(data) !== PREVIEW_LINK_MESSAGE) return null;
  const { url } = data as { url?: unknown };
  return typeof url === "string" ? safeHttpUrl(url) : null;
}

function postAppearance(frame: HTMLIFrameElement | null, src: string, inverted: boolean) {
  const origin = frameOrigin(src);
  if (origin) frame?.contentWindow?.postMessage({ type: PREVIEW_APPEARANCE_MESSAGE, inverted }, origin);
}

export function PreviewFrame({
  src,
  title,
  inverted = false,
}: Readonly<{ src: string; title: string; inverted?: boolean }>) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [darkPage, setDarkPage] = useState<string | null>(null);
  const shownInverted = inverted && darkPage !== src;
  const invertedRef = useRef(shownInverted);
  invertedRef.current = shownInverted;
  useEffect(() => postAppearance(frame.current, src, shownInverted), [shownInverted, src]);
  useEffect(() => {
    const origin = frameOrigin(src);
    let lastOpened = Number.NEGATIVE_INFINITY;
    const onMessage = (event: MessageEvent) => {
      const own = frame.current;
      if (event.source !== own?.contentWindow || event.origin !== origin) return;
      if (messageType(event.data) === PREVIEW_READY_MESSAGE) {
        postAppearance(own, src, invertedRef.current);
        return;
      }
      if (messageType(event.data) === PREVIEW_LOOK_MESSAGE) {
        const dark = (event.data as { dark?: unknown }).dark === true;
        setDarkPage((page) => (dark ? src : page === src ? null : page));
        return;
      }
      const url = clickedLink(event.data);
      if (!url || !frameHasUserFocus(own)) return;
      const now = performance.now();
      if (now - lastOpened < LINK_GAP_MS) return;
      lastOpened = now;
      void openInSystemBrowser(url).then((opened) => {
        if (!opened) void logError("open a link from an HTML preview", `${new URL(url).origin} did not open`);
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [src]);
  return (
    <iframe
      ref={frame}
      title={title}
      src={src}
      sandbox={FRAME_SANDBOX}
      allow="fullscreen"
      onLoad={() => postAppearance(frame.current, src, invertedRef.current)}
      data-inverted={shownInverted || undefined}
      className={cn("size-full border-0 bg-white", shownInverted && "invert hue-rotate-180")}
    />
  );
}

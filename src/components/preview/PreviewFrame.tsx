import { useEffect, useRef } from "react";
import { logError } from "@/lib/log";
import { openInSystemBrowser, safeHttpUrl } from "@/lib/system-browser";

const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads";

export const PREVIEW_LINK_MESSAGE = "oleafly-preview-open-link";
const LINK_GAP_MS = 1000;

function frameOrigin(src: string): string | null {
  try {
    return new URL(src).origin;
  } catch {
    return null;
  }
}

function clickedLink(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, url } = data as { type?: unknown; url?: unknown };
  if (type !== PREVIEW_LINK_MESSAGE || typeof url !== "string") return null;
  return safeHttpUrl(url);
}

export function PreviewFrame({ src, title }: Readonly<{ src: string; title: string }>) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const origin = frameOrigin(src);
    let lastOpened = Number.NEGATIVE_INFINITY;
    const onMessage = (event: MessageEvent) => {
      const own = frame.current;
      if (!own || event.source !== own.contentWindow || event.origin !== origin) return;
      const url = clickedLink(event.data);
      if (!url || document.activeElement !== own) return;
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
      className="size-full border-0 bg-white"
    />
  );
}

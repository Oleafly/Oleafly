import { type CSSProperties, type Ref, type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { artifactFrameClose, artifactFrameOpen } from "@/lib/tauri";
import { type FrameTheme, isPortOffer } from "./frame-document";

const SANDBOXED_ORIGIN = "null";

export function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

function readTheme(): FrameTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useFrameTheme(): FrameTheme {
  return useSyncExternalStore(subscribeTheme, readTheme, readTheme);
}

export function closeFrameToken(token: string): void {
  void artifactFrameClose(token).catch(() => undefined);
}

export async function openFrameDocument(html: string, live: () => boolean): Promise<string | null> {
  const url = await artifactFrameOpen(html);
  if (live()) return url;
  closeFrameToken(tokenOf(url));
  return null;
}

export type FrameLoad = "first" | "replaced" | "again";

export function useFrameDocument(frameRef: RefObject<HTMLIFrameElement | null>) {
  const loadedUrl = useRef<string | null>(null);
  const loadedView = useRef<Window | null>(null);
  const released = useRef<string | null>(null);
  const loaded = useCallback(
    (url: string): FrameLoad => {
      const view = frameRef.current?.contentWindow ?? null;
      if (loadedUrl.current !== url) {
        loadedUrl.current = url;
        loadedView.current = view;
        released.current = tokenOf(url);
        closeFrameToken(released.current);
        return "first";
      }
      return view !== null && view !== loadedView.current ? "replaced" : "again";
    },
    [frameRef],
  );
  const release = useCallback((token: string | null) => {
    if (token && token !== released.current) closeFrameToken(token);
  }, []);
  return { loaded, release };
}

export interface FramePortOptions {
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly channel: string;
  readonly theme: FrameTheme;
  readonly onMessage: (data: unknown) => void;
  readonly accept?: () => boolean;
}

export function useFramePort({ frameRef, channel, theme, onMessage, accept }: FramePortOptions) {
  const port = useRef<MessagePort | null>(null);
  const [connection, setConnection] = useState(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    const accepted = () => acceptRef.current?.() ?? true;
    const onPortOffer = (event: MessageEvent) => {
      const view = frameRef.current?.contentWindow;
      if (event.origin !== SANDBOXED_ORIGIN || !accepted() || !view || event.source !== view) return;
      const offered = event.ports[0];
      if (!offered || !isPortOffer(event.data, channel)) return;
      port.current?.close();
      port.current = offered;
      offered.onmessage = (message: MessageEvent) => {
        if (accepted() && frameRef.current?.contentWindow === view) onMessageRef.current(message.data);
      };
      setConnection((value) => value + 1);
    };
    window.addEventListener("message", onPortOffer);
    return () => {
      window.removeEventListener("message", onPortOffer);
      port.current?.close();
      port.current = null;
    };
  }, [channel, frameRef]);

  const post = useCallback(
    (message: Readonly<Record<string, unknown>>): boolean => {
      if (!port.current) return false;
      port.current.postMessage({ channel, ...message });
      return true;
    },
    [channel],
  );

  const disconnect = useCallback(() => {
    port.current?.close();
    port.current = null;
  }, []);

  useEffect(() => {
    post({ type: "theme", theme });
  }, [post, theme]);

  return { post, disconnect, connection };
}

export function frameHasUserFocus(frame: HTMLIFrameElement | null | undefined): boolean {
  if (!frame || document.activeElement !== frame) return false;
  return navigator.userActivation?.isActive ?? true;
}

export interface SandboxedFrameProps {
  readonly ref?: Ref<HTMLIFrameElement>;
  readonly src: string;
  readonly title: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly lazy?: boolean;
  readonly onLoad: (url: string) => void;
}

export function SandboxedFrame({ ref, src, title, className, style, lazy = false, onLoad }: SandboxedFrameProps) {
  const theme = useFrameTheme();
  return (
    <iframe
      ref={ref}
      src={src}
      onLoad={() => onLoad(src)}
      sandbox="allow-scripts"
      allow=""
      referrerPolicy="no-referrer"
      loading={lazy ? "lazy" : undefined}
      title={title}
      className={className}
      style={{ ...style, colorScheme: theme }}
    />
  );
}

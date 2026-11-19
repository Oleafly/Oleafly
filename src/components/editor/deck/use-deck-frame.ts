import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { frameMessages, loadArtifactRuntime } from "@/components/notes/ArtifactFrame";
import { type DeckFrameMode, deckFrameDocument, frameChannel, isPortOffer } from "@/components/notes/artifact-runtime/frame-document";
import { i18n, loadNamespace } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { artifactFrameClose, artifactFrameOpen } from "@/lib/tauri";
import { deckAssetImports, readDeckAssets } from "./deck-files";

export const DECK_UPDATE_DELAY_MS = 200;
const SANDBOXED_ORIGIN = "null";

export interface DeckInfo {
  readonly pages: number;
  readonly notes: readonly (string | null)[];
  readonly title: string | null;
}

export interface DeckPosition {
  readonly page: number;
  readonly revealed: number;
  readonly steps: number;
}

export interface DeckError {
  readonly title: string;
  readonly detail: string;
}

export type DeckCommand = { type: "next" } | { type: "previous" } | { type: "goto"; page: number };

export interface DeckFrame {
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly url: string | null;
  readonly failure: string | null;
  readonly info: DeckInfo | null;
  readonly position: DeckPosition;
  readonly error: DeckError | null;
  readonly onLoad: (url: string) => void;
  readonly send: (command: DeckCommand) => void;
}

export interface DeckFrameOptions {
  readonly projectId: string;
  readonly path: string;
  readonly code: string;
  readonly mode: DeckFrameMode;
  readonly startPage: number;
  readonly startRevealed?: number;
}

function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

function theme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function readDeckMessage(
  data: unknown,
  channel: string,
):
  | { type: "deck"; info: DeckInfo }
  | { type: "position"; position: DeckPosition }
  | { type: "error"; error: DeckError }
  | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.channel !== channel) return null;
  if (record.type === "deck" && typeof record.pages === "number" && Array.isArray(record.notes)) {
    return {
      type: "deck",
      info: {
        pages: record.pages,
        notes: record.notes.map((note) => (typeof note === "string" ? note : null)),
        title: typeof record.title === "string" ? record.title : null,
      },
    };
  }
  if (record.type === "position" && typeof record.page === "number") {
    return {
      type: "position",
      position: {
        page: record.page,
        revealed: typeof record.revealed === "number" ? record.revealed : 0,
        steps: typeof record.steps === "number" ? record.steps : 0,
      },
    };
  }
  if (record.type === "error" && typeof record.title === "string") {
    return { type: "error", error: { title: record.title, detail: typeof record.detail === "string" ? record.detail : "" } };
  }
  return null;
}

export function useDeckFrame({ projectId, path, code, mode, startPage, startRevealed }: DeckFrameOptions): DeckFrame {
  const [channel] = useState(frameChannel);
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [info, setInfo] = useState<DeckInfo | null>(null);
  const [position, setPosition] = useState<DeckPosition>({ page: startPage, revealed: startRevealed ?? 0, steps: 0 });
  const [error, setError] = useState<DeckError | null>(null);
  const [generation, setGeneration] = useState(0);
  const [connection, setConnection] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;
  const pageRef = useRef(startPage);
  const revealedRef = useRef(startRevealed);
  const sentCode = useRef<string | null>(null);
  const sentAssets = useRef(new Set<string>());
  const loadedUrl = useRef<string | null>(null);
  const loadedView = useRef<Window | null>(null);

  useEffect(() => {
    void generation;
    let live = true;
    let token: string | null = null;
    setUrl(null);
    setFailure(null);
    setInfo(null);
    setError(null);
    const source = codeRef.current;
    void (async () => {
      try {
        const imports = deckAssetImports(path, source);
        const [runtime, assets] = await Promise.all([
          loadArtifactRuntime(),
          readDeckAssets(projectId, imports),
          loadNamespace("notes"),
        ]);
        const messages = { ...frameMessages(), noSlides: i18n.t(($) => $.editor.deck.noSlides) };
        const html = deckFrameDocument(
          source,
          { theme: theme(), channel, parentOrigin: window.location.origin, messages },
          runtime,
          { mode, page: pageRef.current, revealed: revealedRef.current, assets, file: path },
        );
        const opened = await artifactFrameOpen(html);
        token = tokenOf(opened);
        if (!live) {
          void artifactFrameClose(token).catch(() => undefined);
          return;
        }
        sentCode.current = source;
        sentAssets.current = new Set(Object.keys(assets));
        setUrl(opened);
      } catch (cause) {
        if (live) setFailure(describeError(cause));
      }
    })();
    return () => {
      live = false;
      port.current?.close();
      port.current = null;
      if (token && token !== tokenOf(loadedUrl.current ?? "")) void artifactFrameClose(token).catch(() => undefined);
    };
  }, [channel, generation, mode, path, projectId]);

  const onLoad = useCallback((next: string) => {
    const view = frameRef.current?.contentWindow ?? null;
    if (loadedUrl.current !== next) {
      loadedUrl.current = next;
      loadedView.current = view;
      void artifactFrameClose(tokenOf(next)).catch(() => undefined);
      return;
    }
    if (view !== loadedView.current) setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const view = frameRef.current?.contentWindow;
      if (event.origin !== SANDBOXED_ORIGIN || !view || event.source !== view) return;
      const offered = event.ports[0];
      if (!offered || !isPortOffer(event.data, channel)) return;
      port.current?.close();
      port.current = offered;
      offered.onmessage = (message: MessageEvent) => {
        const read = readDeckMessage(message.data, channel);
        if (!read) return;
        if (read.type === "deck") {
          setInfo(read.info);
          setError(null);
        } else if (read.type === "position") {
          pageRef.current = read.position.page;
          revealedRef.current = read.position.revealed;
          setPosition(read.position);
        } else {
          setError(read.error);
        }
      };
      setConnection((value) => value + 1);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channel]);

  useEffect(() => {
    void connection;
    if (sentCode.current === null || sentCode.current === code) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const imports = deckAssetImports(path, code);
        const missing = new Map([...imports].filter(([specifier]) => !sentAssets.current.has(specifier)));
        const assets = missing.size > 0 ? await readDeckAssets(projectId, missing) : {};
        if (!live || !port.current) return;
        for (const specifier of Object.keys(assets)) sentAssets.current.add(specifier);
        sentCode.current = code;
        port.current.postMessage({ channel, type: "source", code, assets });
      })();
    }, DECK_UPDATE_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [channel, code, connection, path, projectId]);

  const send = useCallback(
    (command: DeckCommand) => {
      port.current?.postMessage({ channel, ...command });
    },
    [channel],
  );

  return { frameRef, url, failure, info, position, error, onLoad, send };
}

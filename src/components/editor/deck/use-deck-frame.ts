import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { frameMessages, loadArtifactRuntime } from "@/components/notes/ArtifactFrame";
import { type DeckFrameMode, deckFrameDocument, frameChannel } from "@/components/notes/artifact-runtime/frame-document";
import {
  frameHasUserFocus,
  openFrameDocument,
  tokenOf,
  useFrameDocument,
  useFramePort,
  useFrameTheme,
} from "@/components/notes/artifact-runtime/frame-host";
import { i18n, loadNamespace } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { deckAssetImports, readDeckAssets } from "./deck-files";

export const DECK_UPDATE_DELAY_MS = 200;

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

export interface DeckKey {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
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

function forwardKey(frame: HTMLIFrameElement | null, key: DeckKey): void {
  if (!frame || !frameHasUserFocus(frame)) return;
  frame.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }));
}

export function readDeckMessage(
  data: unknown,
  channel: string,
):
  | { type: "deck"; info: DeckInfo }
  | { type: "position"; position: DeckPosition }
  | { type: "error"; error: DeckError }
  | { type: "key"; key: DeckKey }
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
  if (record.type === "key" && typeof record.key === "string" && typeof record.code === "string") {
    const key = {
      key: record.key,
      code: record.code,
      ctrlKey: record.ctrlKey === true,
      metaKey: record.metaKey === true,
      altKey: record.altKey === true,
      shiftKey: record.shiftKey === true,
    };
    return key.ctrlKey || key.metaKey || key.altKey ? { type: "key", key } : null;
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
  const frameRef = useRef<HTMLIFrameElement>(null);
  const theme = useFrameTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const codeRef = useRef(code);
  codeRef.current = code;
  const pageRef = useRef(startPage);
  const revealedRef = useRef(startRevealed);
  const sentCode = useRef<string | null>(null);
  const sentAssets = useRef(new Set<string>());
  const { loaded, release } = useFrameDocument(frameRef);

  const onMessage = (data: unknown) => {
    const read = readDeckMessage(data, channel);
    if (!read) return;
    if (read.type === "deck") {
      setInfo(read.info);
      setError(null);
    } else if (read.type === "position") {
      pageRef.current = read.position.page;
      revealedRef.current = read.position.revealed;
      setPosition(read.position);
    } else if (read.type === "error") {
      setError(read.error);
    } else {
      forwardKey(frameRef.current, read.key);
    }
  };
  const { post, disconnect, connection } = useFramePort({ frameRef, channel, theme, onMessage });

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
          { theme: themeRef.current, channel, parentOrigin: window.location.origin, messages },
          runtime,
          { mode, page: pageRef.current, revealed: revealedRef.current, assets, file: path },
        );
        const opened = await openFrameDocument(html, () => live);
        if (!opened) return;
        token = tokenOf(opened);
        sentCode.current = source;
        sentAssets.current = new Set(Object.keys(assets));
        setUrl(opened);
      } catch (cause) {
        if (!live) return;
        setFailure(describeError(cause));
        void logError(`open the slide deck ${path}`, cause);
      }
    })();
    return () => {
      live = false;
      disconnect();
      release(token);
    };
  }, [channel, generation, mode, path, projectId, disconnect, release]);

  const onLoad = useCallback(
    (next: string) => {
      if (loaded(next) === "replaced") setGeneration((value) => value + 1);
    },
    [loaded],
  );

  useEffect(() => {
    void connection;
    if (sentCode.current === null || sentCode.current === code) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const imports = deckAssetImports(path, code);
        const missing = new Map([...imports].filter(([specifier]) => !sentAssets.current.has(specifier)));
        const assets = missing.size > 0 ? await readDeckAssets(projectId, missing) : {};
        if (!live || !post({ type: "source", code, assets })) return;
        for (const specifier of Object.keys(assets)) sentAssets.current.add(specifier);
        sentCode.current = code;
      })();
    }, DECK_UPDATE_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [code, connection, path, post, projectId]);

  const send = useCallback((command: DeckCommand) => post(command), [post]);

  return { frameRef, url, failure, info, position, error, onLoad, send };
}

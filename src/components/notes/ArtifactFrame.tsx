import { isTauri } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { Play, RotateCw, Square } from "lucide-react";
import { type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CodeBlock } from "@/components/ui/code-block";
import { HighlightedCode } from "@/components/ui/code-highlighter";
import { watchVisibility } from "@/hooks/use-near-viewport";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { artifactFrameClose, artifactFrameOpen, artifactFrameRuntimeUrl } from "@/lib/tauri";
import {
  type FrameMessages,
  type FrameTheme,
  frameChannel,
  htmlFrameDocument,
  isPortOffer,
  prepareHtml,
  readFrameMessage,
  reactFrameDocument,
  staticFrameDocument,
} from "./artifact-runtime/frame-document";
import {
  type BlockKey,
  blockHash,
  blockTrusted,
  markBlockStarting,
  notePaused,
  setBlockTrusted,
  subscribeBlockTrust,
} from "./block-trust";
import { nodeRoot } from "./node-root";

export type ScriptedKind = "html" | "react";

export const WATCHDOG_MS = 5000;
export const START_GRACE_MS = 10_000;
export const SETTLED_MS = 3000;
export const RELEASE_MS = 30_000;
export const MAX_LIVE_FRAMES = 4;
export const BUILD_DELAY_MS = 400;
export const MIN_HEIGHT = 48;
export const MAX_HEIGHT = 2400;
export const INITIAL_HEIGHT = 160;
export const RUNAWAY_STEPS = 3;
const SOURCE_LINES = 12;
const NOTICE_URLS = 4;
const SANDBOXED_ORIGIN = "null";

let runtimeAddress: Promise<string> | null = null;

export function loadArtifactRuntime(): Promise<string> {
  if (runtimeAddress) return runtimeAddress;
  const pending = artifactFrameRuntimeUrl();
  runtimeAddress = pending;
  pending.catch(() => {
    if (runtimeAddress === pending) runtimeAddress = null;
  });
  return pending;
}

export function resetArtifactRuntime(): void {
  runtimeAddress = null;
}

function useBlockKey(kind: ScriptedKind, source: string, noteId: string | null): BlockKey | null {
  const code = `${kind}\n${source}`;
  const [digest, setDigest] = useState<{ code: string; hash: string } | null>(null);
  useEffect(() => {
    let live = true;
    void blockHash(kind, source).then((hash) => {
      if (live) setDigest({ code: `${kind}\n${source}`, hash });
    });
    return () => {
      live = false;
    };
  }, [kind, source]);
  const hash = digest?.code === code ? digest.hash : null;
  return useMemo(() => (noteId && hash ? { note: noteId, hash } : null), [noteId, hash]);
}

function useBlockTrust(key: BlockKey | null): boolean {
  const read = () => (key ? blockTrusted(key) : false);
  return useSyncExternalStore(subscribeBlockTrust, read, read);
}

interface LiveFrame {
  shown: () => boolean;
  park: () => void;
}

const liveFrames = new Set<LiveFrame>();

function holdLive(entry: LiveFrame): () => void {
  liveFrames.add(entry);
  for (const other of liveFrames) {
    if (liveFrames.size <= MAX_LIVE_FRAMES) break;
    if (other === entry || other.shown()) continue;
    liveFrames.delete(other);
    other.park();
  }
  return () => liveFrames.delete(entry);
}

function readTheme(): FrameTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function useTheme(): FrameTheme {
  return useSyncExternalStore(subscribeTheme, readTheme, readTheme);
}

export function frameMessages(): FrameMessages {
  return {
    unknownImport: i18n.t(($) => $.notes.blocks.artifact.unknownImport, { name: "{{name}}" }),
    compileError: i18n.t(($) => $.notes.blocks.artifact.compileError),
    runtimeError: i18n.t(($) => $.notes.blocks.artifact.runtimeError),
    noComponent: i18n.t(($) => $.notes.blocks.artifact.noComponent),
    loadFailed: i18n.t(($) => $.notes.blocks.artifact.loadFailed),
  };
}

export interface BuiltFrame {
  html: string;
  removed: string[];
}

export async function buildFrame(kind: ScriptedKind, source: string, theme: FrameTheme, channel: string): Promise<BuiltFrame> {
  const options = { theme, channel, parentOrigin: window.location.origin, messages: frameMessages() };
  if (kind === "react") return { html: reactFrameDocument(source, options, await loadArtifactRuntime()), removed: [] };
  const prepared = prepareHtml(source);
  const runtime = prepared.libraries.length > 0 ? await loadArtifactRuntime() : null;
  return { html: htmlFrameDocument(prepared, options, runtime), removed: prepared.removed };
}

export function nextHeight(reported: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(reported)));
}

export function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

export function staticHtml(source: string): string {
  return DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ["script", "iframe", "frame", "object", "embed", "form", "base", "link", "meta"],
    FORBID_ATTR: ["srcset", "action", "formaction"],
    ALLOW_DATA_ATTR: false,
  });
}

function OfflineNotice({ removed }: Readonly<{ removed: readonly string[] }>) {
  const { t } = useTranslation(["notes"]);
  if (removed.length === 0) return null;
  const shown = removed.slice(0, NOTICE_URLS);
  return (
    <div data-artifact-offline className="mt-2 text-[0.6875rem] text-muted-foreground">
      <p>{t(($) => $.notes.blocks.artifact.offline)}</p>
      <ul className="mt-0.5 list-none space-y-0.5 p-0">
        {shown.map((url) => (
          <li key={url} className="truncate font-mono">
            {url}
          </li>
        ))}
        {removed.length > shown.length && (
          <li>{t(($) => $.notes.blocks.artifact.more, { count: removed.length - shown.length })}</li>
        )}
      </ul>
    </div>
  );
}

interface FrameState {
  url: string;
  removed: string[];
}

interface FrameViewProps {
  stalled: boolean;
  failure: string | null;
  frame: FrameState | null;
  frameRef: RefObject<HTMLIFrameElement | null>;
  label: string;
  height: number;
  theme: FrameTheme;
  onLoaded: (url: string) => void;
  onReload: () => void;
}

function FrameView({ stalled, failure, frame, frameRef, label, height, theme, onLoaded, onReload }: Readonly<FrameViewProps>) {
  const { t } = useTranslation(["notes"]);
  if (stalled) {
    return (
      <output data-artifact-stalled className="flex flex-wrap items-center gap-2 py-3">
        <p className="text-xs text-muted-foreground">{t(($) => $.notes.blocks.artifact.stopped)}</p>
        <Button variant="outline" size="xs" onClick={onReload}>
          <RotateCw aria-hidden className="size-3.5" />
          {t(($) => $.notes.blocks.artifact.reload)}
        </Button>
      </output>
    );
  }
  if (failure) {
    return (
      <p role="alert" className="py-3 text-xs text-muted-foreground">
        {t(($) => $.notes.blocks.artifact.failed, { error: failure })}
      </p>
    );
  }
  if (!frame) return <p className="py-3 text-xs text-muted-foreground">{t(($) => $.notes.blocks.artifact.starting)}</p>;
  return (
    <iframe
      ref={frameRef}
      src={frame.url}
      onLoad={() => onLoaded(frame.url)}
      sandbox="allow-scripts"
      allow=""
      referrerPolicy="no-referrer"
      loading="lazy"
      title={t(($) => $.notes.blocks.artifact.frameTitle, { label })}
      className="block w-full rounded-md border-0 bg-transparent"
      style={{ height, colorScheme: theme }}
    />
  );
}

export interface ArtifactFrameProps {
  kind: ScriptedKind;
  source: string;
  label: string;
  guard?: BlockKey | null;
}

export function ArtifactFrame({ kind, source, label, guard = null }: Readonly<ArtifactFrameProps>) {
  const theme = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const guardRef = useRef(guard);
  guardRef.current = guard;
  const [channel, setChannel] = useState(frameChannel);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [parked, setParked] = useState(false);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastBeat = useRef(0);
  const openedAt = useRef(0);
  const settle = useRef<(() => void) | null>(null);
  const visible = useRef(true);
  const heightRef = useRef(INITIAL_HEIGHT);
  const growth = useRef({ delta: 0, count: 0 });
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const [reopened, setReopened] = useState(0);
  const lastReopened = useRef(0);
  const loadedUrl = useRef<string | null>(null);
  const loadedView = useRef<Window | null>(null);
  const left = useRef(false);
  const released = useRef<string | null>(null);

  const park = useCallback(() => {
    setSeen(false);
    setFrame(null);
    setParked(true);
  }, []);

  useEffect(() => {
    if (stalled || !seen) return;
    let live = true;
    let token: string | null = null;
    setFailure(null);
    const delay = reopened === lastReopened.current ? BUILD_DELAY_MS : 0;
    lastReopened.current = reopened;
    const timer = window.setTimeout(() => {
      buildFrame(kind, source, themeRef.current, channel)
        .then(async (built) => {
          if (!live) return;
          const key = guardRef.current;
          settle.current = key ? markBlockStarting(key) : null;
          const url = await artifactFrameOpen(built.html);
          token = tokenOf(url);
          if (!live) {
            void artifactFrameClose(token).catch(() => undefined);
            return;
          }
          left.current = false;
          openedAt.current = performance.now();
          lastBeat.current = openedAt.current + START_GRACE_MS;
          setFrame({ url, removed: built.removed });
          setParked(false);
        })
        .catch((error: unknown) => {
          if (live) setFailure(describeError(error));
          settle.current?.();
        });
    }, delay);
    return () => {
      live = false;
      window.clearTimeout(timer);
      settle.current?.();
      settle.current = null;
      if (token && token !== released.current) void artifactFrameClose(token).catch(() => undefined);
    };
  }, [kind, source, channel, stalled, seen, reopened]);

  useEffect(() => (frame ? holdLive({ shown: () => visible.current, park }) : undefined), [frame, park]);

  const loaded = (url: string) => {
    const view = frameRef.current?.contentWindow ?? null;
    if (loadedUrl.current !== url) {
      loadedUrl.current = url;
      loadedView.current = view;
      released.current = tokenOf(url);
      void artifactFrameClose(released.current).catch(() => undefined);
      return;
    }
    if (view !== null && view !== loadedView.current) {
      setReopened((value) => value + 1);
      return;
    }
    left.current = true;
    setStalled(true);
    setFrame(null);
  };

  useEffect(() => {
    const onFrameMessage = (view: Window, event: MessageEvent) => {
      if (left.current || frameRef.current?.contentWindow !== view) return;
      const message = readFrameMessage(event.data, channel);
      if (!message) return;
      if (message.type === "beat") {
        lastBeat.current = performance.now();
        if (lastBeat.current - openedAt.current >= SETTLED_MS) settle.current?.();
        return;
      }
      const next = nextHeight(message.height);
      const delta = next - heightRef.current;
      if (delta > 0 && growth.current.count >= RUNAWAY_STEPS) return;
      if (delta > 0 && Math.abs(delta - growth.current.delta) <= 1) growth.current.count += 1;
      else growth.current = { delta, count: 0 };
      if (growth.current.count >= RUNAWAY_STEPS) return;
      heightRef.current = next;
      setHeight(next);
    };
    const onPortOffer = (event: MessageEvent) => {
      const view = frameRef.current?.contentWindow;
      if (event.origin !== SANDBOXED_ORIGIN || left.current || !view || event.source !== view) return;
      const offered = event.ports[0];
      if (!offered || !isPortOffer(event.data, channel)) return;
      port.current?.close();
      port.current = offered;
      offered.onmessage = (message) => onFrameMessage(view, message);
    };
    window.addEventListener("message", onPortOffer);
    return () => {
      window.removeEventListener("message", onPortOffer);
      port.current?.close();
      port.current = null;
    };
  }, [channel]);

  useEffect(() => {
    port.current?.postMessage({ channel, type: "theme", theme });
  }, [theme, channel]);

  useEffect(() => {
    const target = wrapRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const stop = watchVisibility(
      target,
      (shown) => {
        if (shown && !visible.current) lastBeat.current = Math.max(lastBeat.current, performance.now());
        visible.current = shown;
        window.clearTimeout(timer);
        if (shown) setSeen(true);
        else timer = window.setTimeout(park, RELEASE_MS);
      },
      "0px",
    );
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [park]);

  useEffect(() => {
    if (!frame || stalled) return;
    const interval = window.setInterval(() => {
      const now = performance.now();
      if (!visible.current || document.visibilityState === "hidden") {
        lastBeat.current = Math.max(lastBeat.current, now);
        return;
      }
      if (now - lastBeat.current > WATCHDOG_MS) {
        setStalled(true);
        setFrame(null);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [frame, stalled]);

  const reload = () => {
    setStalled(false);
    setFrame(null);
    setHeight(INITIAL_HEIGHT);
    heightRef.current = INITIAL_HEIGHT;
    growth.current = { delta: 0, count: 0 };
    setChannel(frameChannel());
  };

  return (
    <div
      ref={wrapRef}
      data-artifact-frame
      className="w-full min-w-0"
      style={parked && !frame && !stalled ? { minHeight: height } : undefined}
    >
      <FrameView
        stalled={stalled}
        failure={failure}
        frame={frame}
        frameRef={frameRef}
        label={label}
        height={height}
        theme={theme}
        onLoaded={loaded}
        onReload={reload}
      />
      {frame && <OfflineNotice removed={frame.removed} />}
    </div>
  );
}

function StaticPreview({ kind, source, label }: Readonly<{ kind: ScriptedKind; source: string; label: string }>) {
  const { t } = useTranslation(["notes"]);
  const theme = useTheme();
  const html = useMemo(() => (kind === "html" ? staticFrameDocument(staticHtml(source), theme) : ""), [kind, source, theme]);
  if (kind === "html") {
    return (
      <iframe
        sandbox=""
        srcDoc={html}
        referrerPolicy="no-referrer"
        loading="lazy"
        title={t(($) => $.notes.blocks.artifact.previewTitle, { label })}
        className="block h-60 w-full rounded-md border bg-transparent"
        style={{ colorScheme: theme }}
      />
    );
  }
  const lines = source.split("\n");
  const excerpt = lines.slice(0, SOURCE_LINES).join("\n");
  return (
    <div data-artifact-source className="w-full min-w-0 text-left">
      <CodeBlock code={source}>
        <HighlightedCode language="tsx" source={lines.length > SOURCE_LINES ? `${excerpt}\n…` : excerpt} />
      </CodeBlock>
    </div>
  );
}

export interface ScriptedBlockProps {
  kind: ScriptedKind;
  source: string;
  label: string;
  noteId: string | null;
  scripted: boolean;
  running: boolean;
  onRunningChange: (running: boolean) => void;
}

export function ScriptedBlock({ kind, source, label, noteId, scripted, running, onRunningChange }: Readonly<ScriptedBlockProps>) {
  const { t } = useTranslation(["notes"]);
  const key = useBlockKey(kind, source, noteId);
  const trusted = useBlockTrust(key);
  const paused = trusted && noteId !== null && notePaused(noteId);
  const auto = trusted && !paused;
  const trustId = useId();
  const canRun = isTauri();
  const live = canRun && (!scripted || auto || running);
  return (
    <div data-scripted-block={kind} className="w-full min-w-0 text-left">
      {scripted && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {canRun &&
            !auto &&
            (running ? (
              <Button variant="outline" size="xs" onClick={() => onRunningChange(false)}>
                <Square aria-hidden className="size-3.5" />
                {t(($) => $.notes.blocks.artifact.stop)}
              </Button>
            ) : (
              <Button variant="outline" size="xs" onClick={() => onRunningChange(true)}>
                <Play aria-hidden className="size-3.5" />
                {t(($) => $.notes.blocks.artifact.run)}
              </Button>
            ))}
          {canRun && key && (
            <div className="flex items-center gap-1.5">
              <Checkbox id={trustId} checked={trusted} onCheckedChange={(checked) => setBlockTrusted(key, checked === true)} />
              <label htmlFor={trustId} className="text-xs text-muted-foreground">
                {t(($) => $.notes.blocks.artifact.alwaysRun)}
              </label>
            </div>
          )}
          {canRun && paused && !running && (
            <p className="text-xs text-muted-foreground">{t(($) => $.notes.blocks.artifact.paused)}</p>
          )}
          {!canRun && <p className="text-xs text-muted-foreground">{t(($) => $.notes.blocks.artifact.desktopOnly)}</p>}
        </div>
      )}
      {live ? (
        <ArtifactFrame kind={kind} source={source} label={label} guard={scripted ? key : null} />
      ) : (
        <StaticPreview kind={kind} source={source} label={label} />
      )}
      {!scripted && !canRun && (
        <p className="mt-2 text-[0.6875rem] text-muted-foreground">{t(($) => $.notes.blocks.artifact.desktopOnly)}</p>
      )}
    </div>
  );
}

export interface ScriptedMount {
  render: (props: ScriptedBlockProps) => void;
  unmount: () => void;
}

export function mountScriptedBlock(host: HTMLElement): ScriptedMount {
  const root = nodeRoot(host);
  return { render: (props) => root.render(<ScriptedBlock {...props} />), unmount: root.unmount };
}

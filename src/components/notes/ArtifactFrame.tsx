import DOMPurify from "dompurify";
import { Play, RotateCw, Square } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CodeBlock } from "@/components/ui/code-block";
import { HighlightedCode } from "@/components/ui/code-highlighter";
import { watchVisibility } from "@/hooks/use-near-viewport";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { readJson, writeJson } from "@/lib/local-storage";
import { artifactFrameClose, artifactFrameOpen, artifactFrameRuntimeUrl } from "@/lib/tauri";
import {
  type FrameMessages,
  type FrameTheme,
  frameChannel,
  htmlFrameDocument,
  prepareHtml,
  readFrameMessage,
  reactFrameDocument,
  staticFrameDocument,
} from "./artifact-runtime/frame-document";

export type ScriptedKind = "html" | "react";

export const RUN_BLOCKS_KEY = "oleafly.notes.runBlocks";
export const WATCHDOG_MS = 5000;
export const START_GRACE_MS = 10_000;
export const BUILD_DELAY_MS = 400;
export const MIN_HEIGHT = 48;
export const MAX_HEIGHT = 2400;
export const INITIAL_HEIGHT = 160;
export const RUNAWAY_STEPS = 3;
const TRUSTED_LIMIT = 500;
const SOURCE_LINES = 12;
const NOTICE_URLS = 4;

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

function desktop(): boolean {
  return Boolean((globalThis as { isTauri?: unknown }).isTauri);
}

const trustListeners = new Set<() => void>();
let trustMemory: string[] | null = null;

function readTrusted(): string[] {
  if (trustMemory) return trustMemory;
  const saved = readJson<unknown>(RUN_BLOCKS_KEY, []);
  trustMemory = Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : [];
  return trustMemory;
}

export function noteRunsBlocks(noteId: string): boolean {
  return readTrusted().includes(noteId);
}

export function setNoteRunsBlocks(noteId: string, run: boolean): void {
  const rest = readTrusted().filter((item) => item !== noteId);
  trustMemory = run ? [...rest, noteId].slice(-TRUSTED_LIMIT) : rest;
  persistTrusted(trustMemory);
  notifyTrust();
}

function persistTrusted(list: readonly string[]): boolean {
  return writeJson(RUN_BLOCKS_KEY, list);
}

function notifyTrust(): void {
  for (const listener of trustListeners) listener();
}

function subscribeTrust(listener: () => void): () => void {
  trustListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== RUN_BLOCKS_KEY) return;
    trustMemory = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    trustListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function useNoteTrust(noteId: string | null): boolean {
  const read = () => (noteId ? noteRunsBlocks(noteId) : false);
  return useSyncExternalStore(subscribeTrust, read, read);
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
  const options = { theme, channel, messages: frameMessages() };
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

export function ArtifactFrame({ kind, source, label }: Readonly<{ kind: ScriptedKind; source: string; label: string }>) {
  const { t } = useTranslation(["notes"]);
  const theme = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [channel, setChannel] = useState(frameChannel);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastBeat = useRef(0);
  const visible = useRef(true);
  const heightRef = useRef(INITIAL_HEIGHT);
  const growth = useRef({ delta: 0, count: 0 });
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const [reopened, setReopened] = useState(0);
  const lastReopened = useRef(0);
  const loadedUrl = useRef<string | null>(null);
  const released = useRef<string | null>(null);

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
          const url = await artifactFrameOpen(built.html);
          token = tokenOf(url);
          if (!live) {
            void artifactFrameClose(token).catch(() => undefined);
            return;
          }
          lastBeat.current = performance.now() + START_GRACE_MS;
          setFrame({ url, removed: built.removed });
        })
        .catch((error: unknown) => {
          if (live) setFailure(describeError(error));
        });
    }, delay);
    return () => {
      live = false;
      window.clearTimeout(timer);
      if (token && token !== released.current) void artifactFrameClose(token).catch(() => undefined);
    };
  }, [kind, source, channel, stalled, seen, reopened]);

  const loaded = (url: string) => {
    if (loadedUrl.current !== url) {
      loadedUrl.current = url;
      released.current = tokenOf(url);
      void artifactFrameClose(released.current).catch(() => undefined);
      return;
    }
    setReopened((value) => value + 1);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const target = frameRef.current;
      if (!target || event.source !== target.contentWindow) return;
      const message = readFrameMessage(event.data, channel);
      if (!message) return;
      if (message.type === "beat") {
        lastBeat.current = performance.now();
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
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channel]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ channel, type: "theme", theme }, "*");
  }, [theme, channel]);

  useEffect(() => {
    const target = wrapRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    return watchVisibility(
      target,
      (shown) => {
        if (shown && !visible.current) lastBeat.current = Math.max(lastBeat.current, performance.now());
        visible.current = shown;
        if (shown) setSeen(true);
      },
      "0px",
    );
  }, []);

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

  if (stalled) {
    return (
      <div ref={wrapRef} data-artifact-stalled role="status" className="flex flex-wrap items-center gap-2 py-3">
        <p className="text-xs text-muted-foreground">{t(($) => $.notes.blocks.artifact.stopped)}</p>
        <Button variant="outline" size="xs" onClick={reload}>
          <RotateCw aria-hidden className="size-3.5" />
          {t(($) => $.notes.blocks.artifact.reload)}
        </Button>
      </div>
    );
  }
  return (
    <div ref={wrapRef} data-artifact-frame className="w-full min-w-0">
      {failure ? (
        <p role="alert" className="py-3 text-xs text-muted-foreground">
          {t(($) => $.notes.blocks.artifact.failed, { error: failure })}
        </p>
      ) : frame ? (
        <iframe
          ref={frameRef}
          src={frame.url}
          onLoad={() => loaded(frame.url)}
          sandbox="allow-scripts"
          allow=""
          referrerPolicy="no-referrer"
          loading="lazy"
          title={t(($) => $.notes.blocks.artifact.frameTitle, { label })}
          className="block w-full rounded-md border-0 bg-transparent"
          style={{ height, colorScheme: theme }}
        />
      ) : (
        <p className="py-3 text-xs text-muted-foreground">{t(($) => $.notes.blocks.artifact.starting)}</p>
      )}
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
  const trusted = useNoteTrust(noteId);
  const trustId = useId();
  const canRun = desktop();
  const live = canRun && (!scripted || trusted || running);
  return (
    <div data-scripted-block={kind} className="w-full min-w-0 text-left">
      {scripted && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {canRun &&
            !trusted &&
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
          {canRun && noteId && (
            <div className="flex items-center gap-1.5">
              <Checkbox
                id={trustId}
                checked={trusted}
                onCheckedChange={(checked) => setNoteRunsBlocks(noteId, checked === true)}
              />
              <label htmlFor={trustId} className="text-xs text-muted-foreground">
                {t(($) => $.notes.blocks.artifact.alwaysRun)}
              </label>
            </div>
          )}
          {!canRun && <p className="text-xs text-muted-foreground">{t(($) => $.notes.blocks.artifact.desktopOnly)}</p>}
        </div>
      )}
      {live ? (
        <ArtifactFrame kind={kind} source={source} label={label} />
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
  const root = createRoot(host);
  return {
    render: (props) =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <ScriptedBlock {...props} />
        </I18nextProvider>,
      ),
    unmount: () => queueMicrotask(() => root.unmount()),
  };
}

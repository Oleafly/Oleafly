import type { PdfLoadState, PdfViewerHandle } from "@oleafly/preview";
import { Download, FileText, Loader2, Minus, MoveHorizontal, Play, Plus, ScrollText } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, shortcut } from "@/lib/utils";
import { outputUrl, type WebApi } from "../api";
import { outputKey, sharedOutputs, shownLocal } from "../compile/outputs";
import { previewMessage } from "../i18n/packages";
import { useWeb } from "../store";
import { useActions } from "./context";
import { dateTime } from "./format";
import { CompileLog } from "./CompileLog";
import { usePersonName } from "./people";

const PdfViewer = lazy(() => import("@oleafly/preview").then((module) => ({ default: module.PdfViewer })));

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEP = 1.2;

type Status = "idle" | "loading" | "ready" | "missing" | "failed";

function usePdfBytes(api: WebApi, projectId: string, key: string | null) {
  const [state, setState] = useState<{ status: Status; data: Uint8Array | null; key: string | null }>({
    status: "idle",
    data: null,
    key: null,
  });
  const [attempt, setAttempt] = useState(0);
  const request = key ? `${key}#${attempt}` : null;
  useEffect(() => {
    if (!request) {
      setState({ status: "idle", data: null, key: null });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, status: current.data ? current.status : "loading" }));
    api.output(projectId, "pdf").then(
      (data) => {
        if (cancelled) return;
        setState(data ? { status: "ready", data, key: request } : { status: "missing", data: null, key: request });
      },
      () => {
        if (!cancelled) setState((current) => ({ ...current, status: "failed" }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, projectId, request]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, retry };
}

function useObjectUrl(bytes: Uint8Array | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes]);
  return url;
}

function seconds(ms: number): string {
  return Math.max(0.1, ms / 1000).toFixed(ms < 10_000 ? 1 : 0);
}

function IconButton({ label, onClick, children }: Readonly<{ label: string; onClick: () => void; children: ReactNode }>) {
  return (
    <Tooltip label={label}>
      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={label} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function PdfPane({ api, projectId }: Readonly<{ api: WebApi; projectId: string }>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const nameOf = usePersonName();
  const compile = useWeb((state) => state.compile);
  const shared = useWeb((state) => sharedOutputs(state.output).pdf);
  const local = useWeb(shownLocal);
  const remote = usePdfBytes(api, projectId, local ? null : outputKey(shared));
  const data = local?.pdf ?? remote.data;
  const localUrl = useObjectUrl(local?.pdf ?? null);
  const identity = local ? `web-compile:${compile.finishedAt ?? 0}` : `web-output:${remote.key ?? ""}`;
  const [scale, setScale] = useState(1);
  const manual = useRef(false);
  const viewer = useRef<PdfViewerHandle>(null);
  const scroller = useRef<HTMLElement>(null);

  const fitWidth = useCallback((): boolean => {
    if (!scroller.current || scroller.current.clientWidth === 0) return false;
    const fit = viewer.current?.getFitScale("width");
    if (!fit) return false;
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit)));
    return true;
  }, []);

  const zoom = (factor: number) => {
    manual.current = true;
    setScale((value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value * factor)));
  };

  const fitAgain = () => {
    manual.current = false;
    fitWidth();
  };

  const onLoad = useCallback(
    (load: PdfLoadState) => {
      if (load.status === "ready" && !manual.current) fitWidth();
    },
    [fitWidth],
  );

  const hasData = data !== null;
  useEffect(() => {
    const element = scroller.current;
    if (!hasData || !element || typeof ResizeObserver === "undefined") return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      if (!manual.current) fitWidth();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasData, fitWidth]);

  let label: string | null = null;
  const failed = compile.status === "failed" && compile.shown === "local" && compile.error !== null;
  if (compile.status === "running") label = t(($) => $.web.compile.running);
  else if (failed) label = t(($) => $.web.compile.couldNotRun);
  else if (local) label = t(($) => $.web.compile.compiledHere, { seconds: seconds(local.timeMs) });
  else if (shared) label = t(($) => $.web.pdf.compiledBy, { name: nameOf(shared.compiledBy), time: dateTime(shared.compiledAt) });

  let body: ReactNode;
  if (data) {
    body = (
      <section ref={scroller} aria-label={t(($) => $.web.pdf.title)} className="isolate min-h-0 flex-1 overflow-auto bg-sidebar">
        <Suspense fallback={<LoadingState className="m-4" label={t(($) => $.web.pdf.loading)} />}>
          <PdfViewer
            ref={viewer}
            data={data}
            documentIdentity={identity}
            scale={scale}
            t={previewMessage}
            onLoadStateChange={onLoad}
            onInverse={(page, x, y, word, context) => void actions.openFromPdf(page, x, y, word, context)}
            onOpenLink={(url) => window.open(url, "_blank", "noopener,noreferrer")}
          />
        </Suspense>
      </section>
    );
  } else if (compile.status === "failed" && compile.shown === "local") {
    body = (
      <ErrorState
        className="m-4"
        message={compile.error === null ? t(($) => $.web.compile.failedNoPdf) : t(($) => $.web.compile.couldNotRun)}
      />
    );
  } else if (!shared || remote.status === "missing") {
    body = (
      <EmptyState
        testId="pdf-empty"
        className="flex-1 px-6 py-10"
        icon={<FileText aria-hidden className="size-8 text-muted-foreground" />}
        title={t(($) => $.web.pdf.emptyTitle)}
        description={compile.ready ? t(($) => $.web.compile.emptyReady) : t(($) => $.web.pdf.emptyDescription)}
      />
    );
  } else if (remote.status === "failed") {
    body = (
      <ErrorState className="m-4" message={t(($) => $.web.pdf.failed)}>
        <Button type="button" size="sm" variant="outline" onClick={remote.retry}>
          {t(($) => $.web.app.retry)}
        </Button>
      </ErrorState>
    );
  } else {
    body = <LoadingState className="m-4" label={t(($) => $.web.pdf.loading)} />;
  }

  const logShown = compile.logOpen && compile.output !== null;
  const download = (local ? localUrl : null) ?? outputUrl(projectId, "pdf");
  const mainFile = local?.target.mainDocument ?? shared?.mainFile ?? "";

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 flex-wrap items-center gap-1 border-b px-2 py-1">
        {compile.ready ? (
          <Tooltip label={t(($) => $.web.compile.hint, { shortcut: shortcut("⌘S") })}>
            <Button
              type="button"
              size="xs"
              variant="outline"
              data-testid="compile"
              disabled={compile.status === "running"}
              onClick={() => actions.compile()}
            >
              {compile.status === "running" ? <Loader2 aria-hidden className="animate-spin" /> : <Play aria-hidden />}
              {t(($) => $.web.compile.action)}
            </Button>
          </Tooltip>
        ) : null}
        <p
          className={cn(
            "min-w-0 flex-1 truncate text-[0.6875rem] @max-lg:order-last @max-lg:basis-full",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
          data-testid="pdf-label"
          title={(failed ? compile.error : label) ?? undefined}
        >
          {label}
        </p>
        <div className="ml-auto flex items-center gap-0.5">
          {compile.output ? (
            <Tooltip label={logShown ? t(($) => $.web.compile.hideLog) : t(($) => $.web.compile.showLog)}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("size-7", compile.output.ok ? undefined : "text-destructive")}
                aria-label={logShown ? t(($) => $.web.compile.hideLog) : t(($) => $.web.compile.showLog)}
                aria-pressed={logShown}
                data-testid="compile-log-toggle"
                onClick={() => actions.toggleLog()}
              >
                <ScrollText aria-hidden />
              </Button>
            </Tooltip>
          ) : null}
          {data ? (
            <>
              <IconButton label={t(($) => $.web.pdf.zoomOut)} onClick={() => zoom(1 / STEP)}>
                <Minus aria-hidden />
              </IconButton>
              <span className="w-10 text-center text-[0.6875rem] tabular-nums text-muted-foreground">
                {t(($) => $.web.pdf.zoom, { percent: Math.round(scale * 100) })}
              </span>
              <IconButton label={t(($) => $.web.pdf.zoomIn)} onClick={() => zoom(STEP)}>
                <Plus aria-hidden />
              </IconButton>
              <IconButton label={t(($) => $.web.pdf.fitWidth)} onClick={fitAgain}>
                <MoveHorizontal aria-hidden />
              </IconButton>
              <Tooltip label={t(($) => $.web.pdf.download)}>
                <a
                  href={download}
                  download={mainFile ? mainFile.replace(/\.[^./]+$/u, ".pdf").split("/").pop() : true}
                  aria-label={t(($) => $.web.pdf.download)}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-7")}
                >
                  <Download aria-hidden />
                </a>
              </Tooltip>
            </>
          ) : null}
        </div>
      </div>
      {local && compile.share === "failed" ? (
        <p role="status" className="border-b px-3 py-1 text-[0.6875rem] text-amber-700 dark:text-amber-400">
          {t(($) => $.web.compile.shareFailed)}
        </p>
      ) : null}
      {body}
      {logShown && compile.output ? <CompileLog output={compile.output} /> : null}
    </div>
  );
}

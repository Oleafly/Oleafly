import type { PdfLoadState, PdfViewerHandle } from "@oleafly/preview";
import { Download, FileText, Minus, MoveHorizontal, Plus } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { outputUrl, type WebApi } from "../api";
import { previewMessage } from "../i18n/packages";
import type { CollabOutputInfo } from "../protocol";
import { useWeb } from "../store";
import { dateTime } from "./format";
import { usePersonName } from "./people";

const PdfViewer = lazy(() => import("@oleafly/preview").then((module) => ({ default: module.PdfViewer })));

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEP = 1.2;

type Status = "idle" | "loading" | "ready" | "missing" | "failed";

export function outputKey(info: CollabOutputInfo | undefined): string | null {
  return info ? `${info.compiledAt}:${info.size}:${info.compiledBy}` : null;
}

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

export function PdfPane({ api, projectId }: Readonly<{ api: WebApi; projectId: string }>) {
  const { t } = useTranslation(["web"]);
  const nameOf = usePersonName();
  const info = useWeb((state) => state.output.find((item) => item.kind === "pdf"));
  const key = outputKey(info);
  const pdf = usePdfBytes(api, projectId, key);
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

  const hasData = pdf.data !== null;
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

  const label = info
    ? t(($) => $.web.pdf.compiledBy, { name: nameOf(info.compiledBy), time: dateTime(info.compiledAt) })
    : null;

  let body: ReactNode;
  if (!info || pdf.status === "missing") {
    body = (
      <EmptyState
        testId="pdf-empty"
        className="flex-1 px-6 py-10"
        icon={<FileText aria-hidden className="size-8 text-muted-foreground" />}
        title={t(($) => $.web.pdf.emptyTitle)}
        description={t(($) => $.web.pdf.emptyDescription)}
      />
    );
  } else if (pdf.status === "failed" && !pdf.data) {
    body = (
      <ErrorState className="m-4" message={t(($) => $.web.pdf.failed)}>
        <Button type="button" size="sm" variant="outline" onClick={pdf.retry}>
          {t(($) => $.web.app.retry)}
        </Button>
      </ErrorState>
    );
  } else if (!pdf.data) {
    body = <LoadingState className="m-4" label={t(($) => $.web.pdf.loading)} />;
  } else {
    body = (
      <section
        ref={scroller}
        aria-label={t(($) => $.web.pdf.title)}
        className="isolate min-h-0 flex-1 overflow-auto bg-sidebar"
      >
        <Suspense fallback={<LoadingState className="m-4" label={t(($) => $.web.pdf.loading)} />}>
          <PdfViewer
            ref={viewer}
            data={pdf.data}
            documentIdentity={`web-output:${pdf.key ?? ""}`}
            scale={scale}
            t={previewMessage}
            onLoadStateChange={onLoad}
            onOpenLink={(url) => window.open(url, "_blank", "noopener,noreferrer")}
          />
        </Suspense>
      </section>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 flex-wrap items-center gap-1 border-b px-2 py-1">
        <p
          className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground"
          data-testid="pdf-label"
          title={label ?? undefined}
        >
          {label}
        </p>
        {pdf.data ? (
          <div className="flex items-center gap-0.5">
            <Tooltip label={t(($) => $.web.pdf.zoomOut)}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t(($) => $.web.pdf.zoomOut)}
                onClick={() => zoom(1 / STEP)}
              >
                <Minus aria-hidden />
              </Button>
            </Tooltip>
            <span className="w-10 text-center text-[0.6875rem] tabular-nums text-muted-foreground">
              {t(($) => $.web.pdf.zoom, { percent: Math.round(scale * 100) })}
            </span>
            <Tooltip label={t(($) => $.web.pdf.zoomIn)}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t(($) => $.web.pdf.zoomIn)}
                onClick={() => zoom(STEP)}
              >
                <Plus aria-hidden />
              </Button>
            </Tooltip>
            <Tooltip label={t(($) => $.web.pdf.fitWidth)}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t(($) => $.web.pdf.fitWidth)}
                onClick={fitAgain}
              >
                <MoveHorizontal aria-hidden />
              </Button>
            </Tooltip>
            <Tooltip label={t(($) => $.web.pdf.download)}>
              <a
                href={outputUrl(projectId, "pdf")}
                download={info?.mainFile ? info.mainFile.replace(/\.[^./]+$/u, ".pdf").split("/").pop() : true}
                aria-label={t(($) => $.web.pdf.download)}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-7")}
              >
                <Download aria-hidden />
              </a>
            </Tooltip>
          </div>
        ) : null}
      </div>
      {body}
    </div>
  );
}

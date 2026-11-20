import { ImageOff, Maximize } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { ZoomBar } from "@/components/ui/zoom-bar";
import { useAsyncTask } from "@/hooks/use-async-task";
import { formatBytes } from "@/lib/format-bytes";
import { imageMime } from "@/lib/image-mime";
import { logError, logWarning } from "@/lib/log";
import { basename } from "@/lib/path-utils";
import { base64ToUint8Array, projectFileSizes, readFileBase64, readProjectBytes } from "@/lib/tauri";

export const IMAGE_MIN_SCALE = 0.1;
export const IMAGE_MAX_SCALE = 8;
export const IMAGE_ZOOM_STEP = 1.25;
export const IMAGE_DIRECT_READ_BYTES = 8 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 64 * 1024 * 1024;

class ImageTooLargeError extends Error {}

async function readImage(projectId: string, path: string): Promise<Blob> {
  const size = (await projectFileSizes(projectId, [path]))[path];
  if (size !== undefined && size > IMAGE_MAX_BYTES) throw new ImageTooLargeError();
  const bytes: ArrayBuffer =
    size !== undefined && size > IMAGE_DIRECT_READ_BYTES
      ? (base64ToUint8Array(await readFileBase64(projectId, path)).buffer as ArrayBuffer)
      : await readProjectBytes(projectId, path);
  return new Blob([bytes], { type: imageMime(path) });
}

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

interface ImageView {
  readonly scale: number | null;
  readonly top: number;
  readonly left: number;
}

const views = new Map<string, ImageView>();

export function clampImageScale(scale: number): number {
  return Math.min(IMAGE_MAX_SCALE, Math.max(IMAGE_MIN_SCALE, scale));
}

export function ImageFileView({ projectId, path }: Readonly<{ projectId: string; path: string }>) {
  return <ImageViewer key={`${projectId}\n${path}`} projectId={projectId} path={path} />;
}

function ImageViewer({ projectId, path }: Readonly<{ projectId: string; path: string }>) {
  const { t } = useTranslation(["common", "editor", "preview"]);
  const key = `${projectId}\n${path}`;
  const read = useAsyncTask<Blob>((error) => {
    if (error instanceof ImageTooLargeError) return t(($) => $.editor.shell.imageTooLarge, { limit: formatBytes(IMAGE_MAX_BYTES) });
    void logError("open an image", error);
    return t(($) => $.editor.shell.imageLoadFailed, { detail: String(error) });
  });
  const { run } = read;
  const src = useObjectUrl(read.result);
  const [undecodable, setUndecodable] = useState(false);
  const [scale, setScale] = useState<number | null>(() => views.get(key)?.scale ?? null);
  const [fit, setFit] = useState(1);
  const [natural, setNatural] = useState(0);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    void run(() => readImage(projectId, path));
  }, [path, projectId, run]);

  const remember = useCallback(() => {
    views.set(key, { scale: scaleRef.current, top: scroller?.scrollTop ?? 0, left: scroller?.scrollLeft ?? 0 });
  }, [key, scroller]);

  const measureFit = useCallback(() => {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image.clientWidth || scaleRef.current !== null) return;
    setFit(image.clientWidth / image.naturalWidth);
  }, []);

  const zoomTo = useCallback(
    (next: number | null) => {
      scaleRef.current = next === null ? null : clampImageScale(next);
      setScale(scaleRef.current);
      remember();
    },
    [remember],
  );

  const shown = scale ?? fit;
  const step = (direction: 1 | -1) =>
    zoomTo((scaleRef.current ?? fit) * (direction > 0 ? IMAGE_ZOOM_STEP : 1 / IMAGE_ZOOM_STEP));

  useEffect(() => {
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomTo((scaleRef.current ?? fit) * Math.exp(-event.deltaY * 0.01));
    };
    const observer = new ResizeObserver(measureFit);
    scroller.addEventListener("wheel", onWheel, { passive: false });
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [fit, measureFit, scroller, zoomTo]);

  useLayoutEffect(() => {
    const saved = views.get(key);
    if (!scroller || !saved || scale === null || natural === 0) return;
    scroller.scrollTop = saved.top;
    scroller.scrollLeft = saved.left;
  }, [key, natural, scale, scroller]);

  if (read.error !== null) return <ErrorState className="p-6" message={read.error} />;
  if (!src) return <LoadingState className="p-6" label={t(($) => $.common.state.loading)} />;
  if (undecodable) {
    return (
      <div
        data-testid="image-undecodable"
        className="flex h-full flex-col items-center justify-center text-center text-muted-foreground"
      >
        <ImageOff className="mb-3 size-10 opacity-30" />
        <p className="text-sm">{basename(path)}</p>
        <p className="text-xs">{t(($) => $.editor.shell.imageUnreadable)}</p>
      </div>
    );
  }

  const percent = Math.round(shown * 100);
  const image = (
    <img
      ref={imageRef}
      src={src}
      alt={basename(path)}
      onError={() => {
        setUndecodable(true);
        void logWarning("show an image", path);
      }}
      onLoad={(event) => {
        setNatural(event.currentTarget.naturalWidth);
        measureFit();
      }}
      style={scale === null || natural === 0 ? undefined : { width: natural * scale, maxWidth: "none" }}
      className={scale === null ? "max-h-full max-w-full object-contain" : undefined}
    />
  );

  return (
    <div className="relative h-full">
      <div ref={setScroller} data-testid="image-viewport" onScroll={remember} className="h-full overflow-auto">
        {scale === null ? (
          <div className="flex h-full items-center justify-center p-4">{image}</div>
        ) : (
          <div className="grid min-h-full w-max min-w-full place-items-center p-4">{image}</div>
        )}
      </div>
      <ZoomBar
        aria-label={basename(path)}
        className="absolute bottom-4 right-4"
        onMouseDown={(event) => event.preventDefault()}
        size="sm"
        value={shown}
        min={IMAGE_MIN_SCALE}
        max={IMAGE_MAX_SCALE}
        onStep={step}
        onReset={() => zoomTo(null)}
        resetLabel={t(($) => $.editor.shell.imageFit)}
        resetIcon={<Maximize aria-hidden />}
        resetDisabled={scale === null}
        labels={{
          zoomOut: t(($) => $.preview.zoom.out),
          zoomIn: t(($) => $.preview.zoom.in),
          value: t(($) => $.preview.zoom.percentLabel, { percent }),
        }}
      />
    </div>
  );
}

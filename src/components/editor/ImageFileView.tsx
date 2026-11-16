import { ImageOff, Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FloatingBar } from "@/components/ui/floating-bar";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { imageMime } from "@/lib/image-mime";
import { basename } from "@/lib/path-utils";
import { readFileBase64 } from "@/lib/tauri";

export const IMAGE_MIN_SCALE = 0.1;
export const IMAGE_MAX_SCALE = 8;
export const IMAGE_ZOOM_STEP = 1.25;

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
  const { t } = useTranslation(["common", "editor", "preview"]);
  const key = `${projectId}\n${path}`;
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [undecodable, setUndecodable] = useState(false);
  const [scale, setScale] = useState<number | null>(() => views.get(key)?.scale ?? null);
  const [fit, setFit] = useState(1);
  const [natural, setNatural] = useState(0);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setErr(null);
    setUndecodable(false);
    readFileBase64(projectId, path)
      .then((b64) => {
        if (!cancelled) setSrc(`data:${imageMime(path)};base64,${b64}`);
      })
      .catch((error) => {
        if (!cancelled) setErr(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);

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

  if (err) {
    return (
      <div className="p-6 text-sm text-destructive">{t(($) => $.editor.shell.imageLoadFailed, { detail: err })}</div>
    );
  }
  if (!src) return <div className="p-6 text-sm text-muted-foreground">{t(($) => $.common.state.loading)}</div>;
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
      onError={() => setUndecodable(true)}
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
      <FloatingBar
        aria-label={basename(path)}
        className="absolute bottom-4 right-4"
        onMouseDown={(event) => event.preventDefault()}
      >
        <TooltipIconButton
          label={t(($) => $.preview.zoom.out)}
          side="top"
          className="rounded-full"
          disabled={shown <= IMAGE_MIN_SCALE}
          onClick={() => step(-1)}
        >
          <Minus aria-hidden />
        </TooltipIconButton>
        <output
          aria-label={t(($) => $.preview.zoom.percentLabel, { percent })}
          className="min-w-12 text-center text-xs font-medium tabular-nums"
        >
          {t(($) => $.preview.zoom.percent, { percent })}
        </output>
        <TooltipIconButton
          label={t(($) => $.preview.zoom.in)}
          side="top"
          className="rounded-full"
          disabled={shown >= IMAGE_MAX_SCALE}
          onClick={() => step(1)}
        >
          <Plus aria-hidden />
        </TooltipIconButton>
        <TooltipIconButton
          label={t(($) => $.editor.shell.imageFit)}
          side="top"
          className="rounded-full"
          disabled={scale === null}
          onClick={() => zoomTo(null)}
        >
          <Maximize aria-hidden />
        </TooltipIconButton>
      </FloatingBar>
    </div>
  );
}

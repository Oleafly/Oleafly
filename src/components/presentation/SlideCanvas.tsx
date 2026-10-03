import { useEffect, useRef, useState } from "react";
import type { SlideBox, SlideDocument } from "@/features/presentation/pdf-slides";
import { cn } from "@/lib/utils";

export interface SlideCanvasProps {
  readonly document: SlideDocument;
  readonly page: number;
  readonly label: string;
  readonly className?: string;
  readonly canvasClassName?: string;
}

export function SlideCanvas({ document, page, label, className, canvasClassName }: SlideCanvasProps) {
  const containerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<SlideBox | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setBox({ width: container.clientWidth, height: container.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box || box.width < 1 || box.height < 1) return;
    void document.render(page, canvas, box, window.devicePixelRatio || 1).catch(() => {});
  }, [document, page, box]);

  return (
    <figure
      ref={containerRef}
      aria-label={label}
      className={cn("flex min-h-0 min-w-0 items-center justify-center overflow-hidden", className)}
    >
      <canvas ref={canvasRef} data-page={page} className={cn("bg-white", canvasClassName)} />
    </figure>
  );
}

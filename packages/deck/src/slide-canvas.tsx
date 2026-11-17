import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { type DesignSystem, designToCssVars } from "./design";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./sdk";

type Props = {
  children: ReactNode;
  scale?: number;
  center?: boolean;
  flat?: boolean;
  freezeMotion?: boolean;
  design?: DesignSystem;
};

const COVER: CSSProperties = { position: "absolute", inset: 0, zIndex: 10 };

export function SlideCanvas({ children, scale, center = true, flat = false, freezeMotion = false, design }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (scale !== undefined) return;
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      setFitScale(Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scale]);

  const measured = scale ?? fitScale;
  const s = measured ?? 1;
  const designVars = design ? designToCssVars(design) : undefined;

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: flat ? "hidden" : undefined }}
    >
      <div
        style={
          {
            overflow: "hidden",
            background: "#fff",
            color: "#000",
            textAlign: "start",
            width: CANVAS_WIDTH * s,
            height: CANVAS_HEIGHT * s,
            visibility: measured === null ? "hidden" : undefined,
            ...(flat ? {} : { borderRadius: 6, boxShadow: "0 8px 30px rgba(0, 0, 0, 0.18)" }),
            ...(designVars ? { ...designVars, background: "var(--osd-bg)" } : {}),
            ...(center ? { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" } : {}),
          } as CSSProperties
        }
      >
        <div
          data-osd-canvas
          data-osd-freeze-motion={freezeMotion ? "" : undefined}
          style={
            {
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              transform: `scale(${s})`,
              transformOrigin: "top left",
              ...(designVars ?? {}),
            } as CSSProperties
          }
        >
          {children}
        </div>
      </div>
      {freezeMotion && <div aria-hidden style={COVER} />}
    </div>
  );
}

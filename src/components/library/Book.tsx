import { useEffect, useState, type ReactNode } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "book" | "simple" | "stripe";

export const DEFAULT_BOOK_COLOR = "#1982c4"; // macOS folder blue

export const BOOK_PALETTE = [
  "#fbf8cc", "#fde4cf", "#ffcfd2", "#f1c0e8", "#cfbaf0",
  "#a3c4f3", "#90dbf4", "#8eecf5", "#98f5e1", "#b9fbc0",
];

export const BOOK_SWATCHES = [DEFAULT_BOOK_COLOR, ...BOOK_PALETTE];

export const BOOK_COLOR_OPTIONS: { name: string; hex: string }[] = [
  { name: "Blue", hex: "#1982c4" },
  { name: "Cream", hex: "#fbf8cc" },
  { name: "Peach", hex: "#fde4cf" },
  { name: "Rose", hex: "#ffcfd2" },
  { name: "Pink", hex: "#f1c0e8" },
  { name: "Lilac", hex: "#cfbaf0" },
  { name: "Sky", hex: "#a3c4f3" },
  { name: "Aqua", hex: "#90dbf4" },
  { name: "Cyan", hex: "#8eecf5" },
  { name: "Mint", hex: "#98f5e1" },
  { name: "Spring", hex: "#b9fbc0" },
];

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt)));
  g = Math.max(0, Math.min(255, Math.round(g + amt)));
  b = Math.max(0, Math.min(255, Math.round(b + amt)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72;
}

export function Book({
  title,
  color,
  textColor,
  illustration,
  date,
  engine,
  variant = "book",
  width = 150,
  onClick,
  starred,
  onStarToggle,
  preview,
  onPreviewRequest,
}: {
  title: string;
  color?: string;
  textColor?: string;
  illustration?: ReactNode;
  date?: string;
  engine?: string;
  variant?: Variant;
  width?: number;
  onClick?: () => void;
  starred?: boolean;
  onStarToggle?: () => void;
  preview?: string | null;
  onPreviewRequest?: () => void;
}) {
  const coverColor = color ?? DEFAULT_BOOK_COLOR;
  const ink = textColor ?? (isLight(coverColor) ? "#1f2937" : "#ffffff");
  const dark = shade(coverColor, -42);
  const [slideReady, setSlideReady] = useState(false);

  useEffect(() => {
    if (!preview) {
      setSlideReady(false);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setSlideReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [preview]);

  return (
    <div
      className="group relative w-full shrink-0 rounded-md"
      style={{ width }}
    >
      <button
        type="button"
        tabIndex={0}
        aria-label={`Open ${title}`}
        onClick={onClick}
        onMouseOver={onPreviewRequest}
        onFocus={onPreviewRequest}
        className="block w-full cursor-pointer rounded-md text-left focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div style={{ perspective: "1600px" }}>
        <div
          className={cn(
            "relative transition-transform duration-500 ease-out [transform-style:preserve-3d]",
            preview || variant === "simple"
              ? "group-hover:-translate-y-1"
              : "group-hover:[transform:rotateY(-18deg)_translateY(-2px)]"
          )}
          style={{ width: "100%", aspectRatio: "8.5 / 11" }}
        >
          {/* back cover - peeks below for thickness */}
          <div className="absolute inset-0 translate-y-[6px] rounded-md" style={{ background: dark }} />
          {/* page edges (bottom) */}
          <div
            className="absolute inset-x-0 bottom-0 translate-y-[3px] rounded-b-md"
            style={{
              height: 6,
              background: "#efe7d6",
              backgroundImage:
                "repeating-linear-gradient(to right, rgba(0,0,0,0.06) 0 1px, transparent 1px 3px)",
            }}
          />
          {/* front cover */}
          <div className="absolute inset-0 flex overflow-hidden rounded-md shadow-lg" style={{ background: coverColor }}>
            {variant !== "simple" && (
              <div className="w-2.5 shrink-0" style={{ background: dark, boxShadow: "1px 0 2px rgba(0,0,0,0.18)" }} />
            )}
            {variant === "stripe" && (
              <div className="absolute inset-x-0 top-0 h-8" style={{ background: dark, opacity: 0.5 }} />
            )}

            {illustration}

            <div className="relative z-10 flex flex-1 flex-col justify-end p-3">
              {engine && (
                <span
                  className="text-[9px] font-semibold uppercase leading-none tracking-wide opacity-55"
                  style={{ color: ink }}
                >
                  {engine}
                </span>
              )}
            </div>

            {preview && (
              <div className={cn("absolute inset-0 z-[15] -translate-x-full overflow-hidden bg-white transition-transform duration-300 ease-out", slideReady && "group-hover:translate-x-0")}>
                <img
                  src={preview}
                  alt=""
                  draggable={false}
                  className="size-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-105"
                />
              </div>
            )}

            <div className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-black/10" />
          </div>
        </div>
        </div>
      </button>
      {onStarToggle && (
        <button
          type="button"
          onClick={onStarToggle}
          aria-label={starred ? "Remove from favorites" : "Add to favorites"}
          className={cn(
            "absolute right-2 top-2 z-20 flex size-7 items-center justify-center rounded-md bg-black/15 backdrop-blur-sm transition-all hover:bg-black/25",
            starred ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          style={{ color: starred ? "#f59e0b" : ink }}
        >
          {starred ? (
            <BookmarkCheck className="size-3.5 fill-current" />
          ) : (
            <Bookmark className="size-3.5" />
          )}
        </button>
      )}
      <div className="mt-2.5 px-0.5">
        <div className="line-clamp-2 break-words text-sm font-semibold leading-snug text-foreground">
          {title}
        </div>
        {date && <div className="mt-0.5 text-xs text-muted-foreground">{date}</div>}
      </div>
    </div>
  );
}

import { forwardRef, type ReactNode } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/** Typed like a Lucide icon, so an Oleafly icon can stand in wherever a Lucide one is expected. */
export type OleaflyIcon = LucideIcon;

/** One command icon: a 20-unit drawing whose parts are styled by role class (oleafly-icons.css). */
export function icon(name: string, drawing: ReactNode): OleaflyIcon {
  // Lucide's stroke and colour props mean nothing here: the roles set both.
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function Icon(
    { className, size = 20, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, color: _color, ...props },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 20 20"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
        data-oleafly-icon={name}
        className={cn("oi", className)}
        {...props}
      >
        {drawing}
      </svg>
    );
  });
  Icon.displayName = `OleaflyIcon(${name})`;
  return Icon;
}

export type Hue = "b" | "g" | "r" | "y" | "n" | "p" | "k";

export const SHEET = "M4.3 1.8h6.9l3.8 3.8v11.4a1.2 1.2 0 0 1-1.2 1.2H4.3A1.2 1.2 0 0 1 3.1 17V3a1.2 1.2 0 0 1 1.2-1.2z";
export const FOLD = "M11.2 1.8v2.9a.9.9 0 0 0 .9.9H15z";
export const GEAR =
  "M7.82 4.73L7.71 2.96L9.42 2.62L10 4.3L12.18 4.73L13.36 3.41L14.81 4.37L14.03 5.97L15.27 7.82L17.04 7.71L17.38 9.42L15.7 10L15.27 12.18L16.59 13.36L15.63 14.81L14.03 14.03L12.18 15.27L12.29 17.04L10.58 17.38L10 15.7L7.82 15.27L6.64 16.59L5.19 15.63L5.97 14.03L4.73 12.18L2.96 12.29L2.62 10.58L4.3 10L4.73 7.82L3.41 6.64L4.37 5.19L5.97 5.97z";
/** A four-pointed star with concave sides, centred on (cx, cy), reaching r in each direction. */
export const SPARKLE = (cx: number, cy: number, r: number) => {
  const [a, b, c, d] = [0.086, 0.6, 0.4, 0.914].map((k) => +(k * r).toFixed(2));
  return `M${cx} ${cy - r}c${a} ${b} ${c} ${d} ${r} ${r}c-${b} ${a} -${d} ${c} -${r} ${r}c-${a} -${b} -${c} -${d} -${r} -${r}c${b} -${a} ${d} -${c} ${r} -${r}z`;
};
/**
 * A solid badge in the bottom-right corner. Draw what sits behind it inside <Cut>, which masks out
 * a ring around the badge so the gap shows whatever surface the icon is on.
 */
export const Cut = ({ children }: Readonly<{ children: ReactNode }>) => <g mask="url(#oi-cut-badge)">{children}</g>;
export const Badge = ({ hue, children }: Readonly<{ hue: Hue; children: ReactNode }>) => (
  <>
    <circle className={`${hue}s`} cx="14.3" cy="14.3" r="4.6" />
    <path className="gl" d="M10.9 13.1a3.5 3.5 0 0 1 2-2.2" />
    {children}
  </>
);

/** A coloured tile in the bottom-right corner; draw what sits behind it inside <CutTile>. */
export const CutTile = ({ children }: Readonly<{ children: ReactNode }>) => <g mask="url(#oi-cut-tile)">{children}</g>;
export const Tile = ({ hue, children }: Readonly<{ hue: Hue; children: ReactNode }>) => (
  <>
    <rect className={`${hue}s`} x="11.2" y="11.2" width="7" height="7" rx="1.7" />
    <path className="gl" d="M12.3 13.6a1.5 1.5 0 0 1 1.2-1.3" />
    {children}
  </>
);

/** A sheet of paper with a coloured tile in the corner: the look of every file type. */
export const FileSheet = ({ hue, children }: Readonly<{ hue: Hue; children: ReactNode }>) => (
  <>
    <CutTile>
      <path className="of" d={SHEET} />
      <path className="of" d={FOLD} />
      <path className="o ln thick" d="M5.3 6.2h4.2M5.3 8.8h5.4M5.3 11.4h3.4" />
    </CutTile>
    <Tile hue={hue}>{children}</Tile>
  </>
);

import { createElement, forwardRef, type ReactNode } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";
import { type InstalledIconPack, type SvgNode, useColorDrawing, useIconPackState } from "./icon-pack";

// Children go in as separate arguments, so a static drawing needs no keys.
function render(nodes: readonly SvgNode[]): ReactNode[] {
  return nodes.map((node) => createElement(node.tag, node.props, ...render(node.children)));
}

type ColorIconProps = Omit<LucideProps, "ref"> & Readonly<{ name: string; drawing: readonly SvgNode[]; aliases?: string }>;

/** Draws one colour icon from the installed pack on its 20-unit grid. */
export const ColorIconSvg = forwardRef<SVGSVGElement, ColorIconProps>(function ColorIconSvg(
  { name, drawing, aliases, className, size = 20, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, color: _color, ...props },
  ref,
) {
  return createElement(
    "svg",
    {
      ref,
      viewBox: "0 0 20 20",
      width: size,
      height: size,
      "aria-hidden": "true",
      focusable: "false",
      "data-oleafly-icon": name,
      className: cn("oi", aliases, className),
      ...props,
    },
    ...render(drawing),
  );
});

/**
 * One icon in both packs: the Lucide line icon for Neutral and the colour drawing `name` from the
 * installed pack for Color. A null line icon shows nothing in Neutral, as before the pack existed.
 * `aliases` carries the Lucide class names, so selectors such as svg.lucide-trash-2 still match.
 */
export function packIcon(line: LucideIcon | null, name: string, aliases?: string): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function PackIcon(props, ref) {
    const drawing = useColorDrawing(name);
    if (drawing) return <ColorIconSvg ref={ref} name={name} drawing={drawing} aliases={aliases} {...props} />;
    const Line = line;
    return Line ? <Line ref={ref} {...props} /> : null;
  });
  Icon.displayName = `PackIcon(${name})`;
  return Icon as LucideIcon;
}

/** A pack's stylesheet and shared gradients, which its drawings need on the page. */
export function IconPackStyles({ pack, id }: Readonly<{ pack: InstalledIconPack; id: string }>) {
  return (
    <>
      <style data-icon-pack={id}>{pack.css}</style>
      {createElement(
        "svg",
        { "aria-hidden": "true", focusable: "false", width: 0, height: 0, style: { position: "absolute", width: 0, height: 0, overflow: "hidden" } },
        createElement("defs", null, ...render(pack.defs)),
      )}
    </>
  );
}

/** The colour pack's stylesheet and shared gradients, mounted once while the pack is showing. */
export function IconPackHost() {
  const { selected, installed } = useIconPackState();
  if (selected !== "color" || !installed) return null;
  return <IconPackStyles pack={installed} id="color" />;
}

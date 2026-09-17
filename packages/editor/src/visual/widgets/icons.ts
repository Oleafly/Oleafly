const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export type VisualIcon = "book" | "tag" | "link" | "chevron";

const ICON_PATHS: Record<VisualIcon, string[]> = {
  book: [
    "M4 4h6a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5H4z",
    "M20 4h-6a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5H20z",
  ],
  tag: ["M3 3h8.5L21 12.5 12.5 21 3 11.5z", "M7.5 7.5h.01"],
  link: [
    "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2",
    "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2",
  ],
  chevron: ["M6 9l6 6 6-6"],
};

export function createIcon(icon: VisualIcon, className = "ofl-visual-icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "1em");
  svg.setAttribute("height", "1em");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  for (const definition of ICON_PATHS[icon]) {
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", definition);
    svg.append(path);
  }
  return svg;
}

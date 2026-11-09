import DOMPurify from "dompurify";
import { PenTool } from "lucide-react";
import { i18n } from "@/i18n";
import { blockMessage, type NoteBlockKind } from "./note-blocks";

export const MAX_SVG_CHARS = 2 * 1024 * 1024;
const SVG_NS = "http://www.w3.org/2000/svg";
const LINK_ATTRIBUTES = ["href", "xlink:href", "src"];
const CSS_REMOTE = /url\(\s*(['"]?)(?!#|data:)[^)]*\1\s*\)|@import[^;]*;?/giu;

export type SvgResult = { ok: true; svg: string } | { ok: false; problem: "empty" | "invalid" | "large" };

function localReference(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("#") || /^data:image\/(?:png|jpe?g|gif|webp);base64,/iu.test(trimmed);
}

export function sanitizeSvg(source: string): SvgResult {
  const text = source.trim();
  if (!text) return { ok: false, problem: "empty" };
  if (text.length > MAX_SVG_CHARS) return { ok: false, problem: "large" };
  const clean = DOMPurify.sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "iframe", "a", "animate", "set", "animateMotion", "animateTransform"],
    FORBID_ATTR: ["onload", "onerror", "onclick", "onbegin", "onend"],
    RETURN_TRUSTED_TYPE: false,
  });
  const document = new DOMParser().parseFromString(String(clean), "image/svg+xml");
  const root = document.documentElement;
  if (document.getElementsByTagName("parsererror").length > 0 || root.localName !== "svg") {
    return { ok: false, problem: "invalid" };
  }
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const name of [...element.getAttributeNames()]) {
      const value = element.getAttribute(name) ?? "";
      if (/^on/iu.test(name)) element.removeAttribute(name);
      else if (LINK_ATTRIBUTES.includes(name.toLowerCase()) && !localReference(value)) element.removeAttribute(name);
      else if (name === "style") element.setAttribute(name, value.replace(CSS_REMOTE, ""));
    }
    if (element.localName === "style") element.textContent = (element.textContent ?? "").replace(CSS_REMOTE, "");
  }
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", SVG_NS);
  return { ok: true, svg: new XMLSerializer().serializeToString(root) };
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function svgTitle(svg: string): string {
  const match = /<title[^>]*>([^<]*)<\/title>/iu.exec(svg);
  return match?.[1]?.trim() ?? "";
}

export function paintSvg(preview: HTMLElement, source: string): undefined {
  const result = sanitizeSvg(source);
  if (!result.ok) {
    blockMessage(
      preview,
      result.problem === "large"
        ? i18n.t(($) => $.notes.blocks.svg.tooLarge)
        : result.problem === "empty"
          ? i18n.t(($) => $.notes.blocks.svg.empty)
          : i18n.t(($) => $.notes.blocks.svg.invalid),
    );
    return undefined;
  }
  const image = document.createElement("img");
  image.className = "note-svg";
  image.draggable = false;
  image.alt = svgTitle(result.svg) || i18n.t(($) => $.notes.blocks.svg.alt);
  image.src = svgDataUrl(result.svg);
  preview.replaceChildren(image);
  return undefined;
}

export const SVG_TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120">
  <title>Two-state system</title>
  <circle cx="60" cy="60" r="34" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
  <circle cx="180" cy="60" r="34" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/>
  <path d="M96 48 Q120 30 144 48" fill="none" stroke="#64748b" stroke-width="2"/>
  <path d="M144 72 Q120 90 96 72" fill="none" stroke="#64748b" stroke-width="2"/>
  <text x="60" y="65" text-anchor="middle" font-family="sans-serif" font-size="16">A</text>
  <text x="180" y="65" text-anchor="middle" font-family="sans-serif" font-size="16">B</text>
</svg>`;

export const svgBlock: NoteBlockKind = {
  name: "svg",
  label: () => "SVG",
  icon: PenTool,
  paint: (preview, source) => paintSvg(preview, source),
  template: () => ({ info: "svg", source: SVG_TEMPLATE }),
};

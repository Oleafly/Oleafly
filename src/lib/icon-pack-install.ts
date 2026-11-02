import { type InstalledIconPack, setInstalledIconPack, type SvgNode } from "@/components/icons/icon-pack";
import { COLOR_ICON_PACK } from "@/lib/icon-pack-pin";

// The colour icon pack does not ship with the app: it is downloaded on request, checked against
// the SHA-256 pinned at build time, and kept in local storage. In development the dev server
// serves the freshly built pack (scripts/build-icon-pack.mjs).
const STORAGE_KEY = "oleafly.iconPack.color";

export const COLOR_ICON_PACK_URL = import.meta.env.DEV
  ? `/__oleafly/icon-packs/${COLOR_ICON_PACK.file}`
  : `https://cdn.oleafly.com/icon-packs/${COLOR_ICON_PACK.file}`;

export class IconPackError extends Error {
  constructor(readonly reason: "network" | "integrity" | "invalid") {
    super(`icon pack ${reason}`);
  }
}

// The pack may only draw shapes and gradients, so a tampered file cannot run code or load anything.
const NUMBER = /^-?[0-9.]+(e-?[0-9]+)?%?$/i;
const ATTRIBUTES: Readonly<Record<string, readonly [string, RegExp]>> = {
  class: ["className", /^[a-z0-9 -]+$/],
  d: ["d", /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/],
  transform: ["transform", /^[a-z0-9().,\s-]+$/],
  "fill-rule": ["fillRule", /^(evenodd|nonzero)$/],
  mask: ["mask", /^url\(#oi-[a-z0-9-]+\)$/],
  id: ["id", /^oi-[a-z0-9-]+$/],
  fill: ["fill", /^#[0-9a-f]{3,6}$/i],
  maskUnits: ["maskUnits", /^userSpaceOnUse$/],
  x: ["x", NUMBER], y: ["y", NUMBER], width: ["width", NUMBER], height: ["height", NUMBER],
  rx: ["rx", NUMBER], ry: ["ry", NUMBER], cx: ["cx", NUMBER], cy: ["cy", NUMBER], r: ["r", NUMBER],
  x1: ["x1", NUMBER], y1: ["y1", NUMBER], x2: ["x2", NUMBER], y2: ["y2", NUMBER], offset: ["offset", NUMBER],
};
const TAGS = new Set(["g", "path", "rect", "circle", "ellipse", "linearGradient", "stop", "mask"]);
const STOP_STYLE = /^stop-color:\s*var\(--oi-[a-z0-9-]+\);?$/;
const UNSAFE_CSS = /@import|url\((?!#oi-)|expression\(|javascript:|<\/?style/i;

function toNode(element: Element): SvgNode {
  if (!TAGS.has(element.tagName)) throw new IconPackError("invalid");
  const props: Record<string, unknown> = {};
  for (const { name, value } of Array.from(element.attributes)) {
    if (name === "style") {
      if (element.tagName !== "stop" || !STOP_STYLE.test(value)) throw new IconPackError("invalid");
      props.style = { stopColor: value.slice(value.indexOf(":") + 1).replace(/;$/, "").trim() };
      continue;
    }
    const rule = ATTRIBUTES[name];
    if (!rule?.[1].test(value)) throw new IconPackError("invalid");
    props[rule[0]] = value;
  }
  return { tag: element.tagName, props, children: Array.from(element.children, toNode) };
}

function parseMarkup(markup: string): SvgNode[] {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new IconPackError("invalid");
  return Array.from(doc.documentElement.children, toNode);
}

export function parseIconPack(text: string): InstalledIconPack {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new IconPackError("invalid");
  }
  const pack = raw as { format?: unknown; css?: unknown; defs?: unknown; icons?: unknown };
  if (pack.format !== 1 || typeof pack.css !== "string" || typeof pack.defs !== "string" || !pack.icons || typeof pack.icons !== "object") {
    throw new IconPackError("invalid");
  }
  if (UNSAFE_CSS.test(pack.css)) throw new IconPackError("invalid");
  const icons: Record<string, SvgNode[]> = {};
  for (const [name, markup] of Object.entries(pack.icons as Record<string, unknown>)) {
    if (!/^[a-z0-9-]+$/.test(name) || typeof markup !== "string") throw new IconPackError("invalid");
    icons[name] = parseMarkup(markup);
  }
  return { css: pack.css, defs: parseMarkup(pack.defs), icons };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verified(text: string): Promise<InstalledIconPack> {
  if ((await sha256(text)) !== COLOR_ICON_PACK.sha256) throw new IconPackError("integrity");
  return parseIconPack(text);
}

export function colorIconPackStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Downloads the colour pack, checks it, stores it and makes it available. */
export async function downloadColorIconPack(): Promise<void> {
  let text: string;
  try {
    const response = await fetch(COLOR_ICON_PACK_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    text = await response.text();
  } catch {
    throw new IconPackError("network");
  }
  const pack = await verified(text);
  localStorage.setItem(STORAGE_KEY, text);
  setInstalledIconPack(pack);
}

/** Loads the stored pack at startup. A pack built for another app version is dropped. */
export async function loadStoredColorIconPack(): Promise<void> {
  let text: string | null = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!text) return;
  try {
    setInstalledIconPack(await verified(text));
  } catch {
    removeColorIconPack();
  }
}

export function removeColorIconPack(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is unavailable; there is nothing stored to remove.
  }
  setInstalledIconPack(null);
}

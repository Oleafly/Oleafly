const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SENTINEL = "#010203";

function expandShortHex(value: string): string {
  const digits = value.slice(1);
  if (digits.length === 6) return value.toLowerCase();
  if (digits.length === 8) return `#${digits.slice(0, 6)}`.toLowerCase();
  const rgb = digits.slice(0, 3);
  return `#${rgb
    .split("")
    .map((digit) => digit + digit)
    .join("")}`.toLowerCase();
}

export function cssColorToHex(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (HEX_PATTERN.test(trimmed)) return expandShortHex(trimmed);
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = SENTINEL;
  context.fillStyle = trimmed;
  const normalized = String(context.fillStyle);
  if (normalized === SENTINEL && trimmed.toLowerCase() !== SENTINEL) return null;
  if (HEX_PATTERN.test(normalized)) return expandShortHex(normalized);
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(normalized);
  if (!match) return null;
  return `#${[match[1], match[2], match[3]]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function readCssVariable(name: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

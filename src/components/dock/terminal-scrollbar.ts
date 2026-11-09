import type { ITheme } from "@xterm/xterm";
import { cssColorToHex, readCssVariable } from "@/lib/css-color";

export const TERMINAL_SCROLLBAR_WIDTH = 8;

export interface ScrollThumbMix {
  rest: number;
  active: number;
}

function share(name: string): number | null {
  const value = Number.parseFloat(readCssVariable(name));
  return Number.isFinite(value) && value > 0 && value <= 100 ? value / 100 : null;
}

export function readScrollThumbMix(): ScrollThumbMix | null {
  const rest = share("--ofl-scroll-thumb-mix");
  const active = share("--ofl-scroll-thumb-active-mix");
  return rest !== null && active !== null ? { rest, active } : null;
}

function withAlpha(color: string | undefined, alpha: number): string | null {
  const hex = color ? cssColorToHex(color) : null;
  return hex ? `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` : null;
}

export function withQuietScrollbar<T extends ITheme>(theme: T, mix: ScrollThumbMix | null = readScrollThumbMix()): T & ITheme {
  const rest = mix ? withAlpha(theme.foreground, mix.rest) : null;
  const hover = mix ? withAlpha(theme.foreground, mix.active) : null;
  return {
    ...theme,
    overviewRulerBorder: "transparent",
    ...(rest && hover
      ? { scrollbarSliderBackground: rest, scrollbarSliderHoverBackground: hover, scrollbarSliderActiveBackground: hover }
      : {}),
  };
}

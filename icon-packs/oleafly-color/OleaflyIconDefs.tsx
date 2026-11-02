import { Fragment } from "react";

const HUES = ["blue", "green", "red", "yellow", "amber", "purple", "graphite"] as const;

const stop = (offset: number, token: string) => (
  <stop offset={offset} style={{ stopColor: `var(--oi-${token})` }} />
);

/**
 * The shared top-lit gradients Oleafly Icons fill with, and the badge cut-out mask. Mount once per
 * window; the stops read the --oi-* tokens, so the gradients follow the theme.
 */
export function OleaflyIconDefs() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <linearGradient id="oi-g-paper" x1="0" y1="0" x2="0" y2="1">
          {stop(0.25, "paper-top")}
          {stop(1, "paper")}
        </linearGradient>
        {HUES.map((hue) => (
          <Fragment key={hue}>
            <linearGradient id={`oi-g-${hue}-soft`} x1="0" y1="0" x2="0" y2="1">
              {stop(0, "rim")}
              {stop(0.3, `${hue}-soft-top`)}
              {stop(1, `${hue}-soft`)}
            </linearGradient>
            <linearGradient id={`oi-g-${hue}-solid`} x1="0" y1="0" x2="0" y2="1">
              {stop(0, `${hue}-top`)}
              {stop(1, `${hue}-deep`)}
            </linearGradient>
          </Fragment>
        ))}
        <mask id="oi-cut-badge" maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <rect width="20" height="20" fill="#fff" />
          <circle cx="14.3" cy="14.3" r="5.6" fill="#000" />
        </mask>
        <mask id="oi-cut-tile" maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <rect width="20" height="20" fill="#fff" />
          <rect x="10" y="10" width="9.4" height="9.4" rx="2.6" fill="#000" />
        </mask>
      </defs>
    </svg>
  );
}

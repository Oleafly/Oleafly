import type { Line } from "./lines";
import type { TextItem } from "./types";

type Style = "bold" | "italic" | "mono" | "plain";

function styleOf(fontName: string): Style {
  if (/bold/i.test(fontName)) return "bold";
  if (/italic|oblique/i.test(fontName)) return "italic";
  if (/mono|courier/i.test(fontName)) return "mono";
  return "plain";
}

const CMD: Record<Exclude<Style, "plain">, string> = {
  bold: String.raw`\textbf`,
  italic: String.raw`\textit`,
  mono: String.raw`\texttt`,
};

type Script = "sup" | "sub" | null;

function scriptOf(item: TextItem, line: Line): Script {
  if (item.fontSize > line.fontSize * 0.8) return null;
  const dy = item.y - line.y;
  if (dy > line.fontSize * 0.2) return "sup";
  if (dy < -line.fontSize * 0.15) return "sub";
  return null;
}

interface StyleRun {
  style: Style;
  script: Script;
  text: string;
  gapBefore: boolean;
}

function runsForLine(line: Line): StyleRun[] {
  const runs: StyleRun[] = [];
  let prevEnd: number | null = null;
  for (const item of line.items) {
    const style = styleOf(item.fontName);
    const script = scriptOf(item, line);
    // scripts attach to the preceding word; words need a real horizontal gap
    const gapBefore =
      script === null && prevEnd != null && item.x - prevEnd > line.fontSize * 0.2;
    const last = runs.at(-1);
    if (last?.style === style && last.script === script) {
      last.text += (gapBefore ? " " : "") + item.str;
    } else {
      runs.push({ style, script, text: item.str, gapBefore });
    }
    prevEnd = item.x + item.width;
  }
  return runs;
}

function renderRun(run: StyleRun, escape: (s: string) => string): string {
  let piece = escape(run.text.trim());
  if (run.style !== "plain") piece = `${CMD[run.style]}{${piece}}`;
  if (run.script === "sup") piece = String.raw`\textsuperscript{${piece}}`;
  if (run.script === "sub") piece = String.raw`\textsubscript{${piece}}`;
  return piece;
}

export function renderLineText(line: Line, escape: (s: string) => string): string {
  let out = "";
  for (const [i, run] of runsForLine(line).entries()) {
    out += (i > 0 && run.gapBefore ? " " : "") + renderRun(run, escape);
  }
  return out.replace(/ {2,}/g, " ").trim();
}

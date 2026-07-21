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
  bold: "\\textbf",
  italic: "\\textit",
  mono: "\\texttt",
};

type Script = "sup" | "sub" | null;

function scriptOf(item: TextItem, line: Line): Script {
  if (item.fontSize > line.fontSize * 0.8) return null;
  const dy = item.y - line.y;
  if (dy > line.fontSize * 0.2) return "sup";
  if (dy < -line.fontSize * 0.15) return "sub";
  return null;
}

export function renderLineText(line: Line, escape: (s: string) => string): string {
  const runs: { style: Style; script: Script; text: string; gapBefore: boolean }[] = [];
  let prevEnd: number | null = null;
  for (const item of line.items) {
    const style = styleOf(item.fontName);
    const script = scriptOf(item, line);
    // scripts attach to the preceding word; words need a real horizontal gap
    const gapBefore =
      script === null && prevEnd != null && item.x - prevEnd > line.fontSize * 0.2;
    const last = runs[runs.length - 1];
    if (last && last.style === style && last.script === script) {
      last.text += (gapBefore ? " " : "") + item.str;
    } else {
      runs.push({ style, script, text: item.str, gapBefore });
    }
    prevEnd = item.x + item.width;
  }
  let out = "";
  for (const [i, run] of runs.entries()) {
    let piece = escape(run.text.trim());
    if (run.style !== "plain") piece = `${CMD[run.style]}{${piece}}`;
    if (run.script === "sup") piece = `\\textsuperscript{${piece}}`;
    if (run.script === "sub") piece = `\\textsubscript{${piece}}`;
    out += (i > 0 && run.gapBefore ? " " : "") + piece;
  }
  return out.replace(/[ ]{2,}/g, " ").trim();
}

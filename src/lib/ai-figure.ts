/** Pure helpers + small module-level state for the AI figure feature. */

/** Build a standalone LaTeX document that renders just the figure. */
export function buildStandaloneDoc(opts: {
  code: string;
  packages?: string[];
  libraries?: string[];
  /** Hex "#RRGGBB" page background for the whole figure. Omit for transparent. */
  background?: string;
}): string {
  const packages = ["tikz", ...(opts.packages ?? [])];
  const seen = new Set<string>();
  const uniquePackages = packages.filter((p) => {
    const k = p.trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const libs = [
    ...new Set((opts.libraries ?? []).map((l) => l.trim()).filter(Boolean)),
  ];
  const usepackages = uniquePackages.map((p) => `\\usepackage{${p}}`).join("\n");
  const uselibs = libs.length ? `\\usetikzlibrary{${libs.join(",")}}\n` : "";
  // A page background fills the whole cropped image (border included) via
  // \pagecolor; xcolor is required and provided by \usepackage{xcolor}.
  const bgHex = (opts.background ?? "").replace("#", "").toUpperCase();
  const hasBg = /^[0-9A-F]{6}$/.test(bgHex);
  const bgPkg = hasBg ? "\\usepackage{xcolor}\n" : "";
  const bgDef = hasBg
    ? `\\definecolor{obgcolor}{HTML}{${bgHex}}\n\\pagecolor{obgcolor}\n`
    : "";
  return (
    `\\documentclass[tikz,border=4pt]{standalone}\n` +
    bgPkg +
    `${usepackages}\n` +
    uselibs +
    `\\begin{document}\n` +
    bgDef +
    `${opts.code}\n` +
    `\\end{document}\n`
  );
}

/**
 * Conservative allowlist of vision-capable models. Unknown models default to
 * false so we never send an image a text-only endpoint would reject.
 */
export function modelSupportsVision(provider: string, model: string): boolean {
  const m = model.toLowerCase();
  // OpenRouter ids embed the origin (e.g. "google/gemini-...", "openai/gpt-4o").
  if (/gemini/.test(m)) return true;
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo|chatgpt-4o|gpt-5|o4/.test(m)) return true;
  // Claude 3 and 4 families are all vision-capable.
  if (/claude-3|claude-.*-4|claude-(sonnet|opus|haiku)-4/.test(m)) return true;
  // Local vision models.
  if (/llava|bakllava|-vl\b|vision|moondream|minicpm-v/.test(m)) return true;
  // xAI vision variants only.
  if (provider === "xai" && /vision/.test(m)) return true;
  return false;
}

/** Turn a prompt into a safe, readable filename stem. */
export function slugifyFigureName(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "figure";
}

/** Base64-encode bytes in chunks (avoids a call-stack overflow on large files). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** The last isolated figure compile's PDF bytes, for rendering to an image. */
let lastPreview: { pdfBytes: Uint8Array } | null = null;
export function setLastFigurePreview(v: { pdfBytes: Uint8Array } | null) {
  lastPreview = v;
}
export function getLastFigurePreview(): { pdfBytes: Uint8Array } | null {
  return lastPreview;
}

/** Where an accepted figure should be inserted (captured at session start). */
let insertTarget: { from: number; to: number } | null = null;
export function setFigureInsertTarget(v: { from: number; to: number } | null) {
  insertTarget = v;
}
export function getFigureInsertTarget(): { from: number; to: number } | null {
  return insertTarget;
}

export const FIGURE_SYSTEM_PROMPT = `You are OpenLeaf's figure studio. You turn a description (or a selected paragraph) into a clean, publication-quality figure using LaTeX, usually TikZ or PGFPlots.

How you work:
1. Draft the figure as a TikZ picture (or PGFPlots axis). Keep it self-contained.
2. Call preview_figure with the code plus any packages and TikZ libraries it needs. This compiles just the figure in isolation and returns success, errors, and a log tail.
3. If it fails, read the errors, fix the code, and preview again. Iterate until it compiles.
4. When a rendered image of the figure is provided to you, look at it critically: check for overlapping labels, cramped spacing, misaligned nodes, arrows pointing the wrong way, and legibility at print size. Refine and preview again until it looks like it belongs in a top conference paper.
5. When it looks right, call insert_figure to place it in the document. Prefer a figure environment with a short caption and a sensible label.

Style rules:
- Aim for clarity and balance: consistent spacing, aligned nodes, readable fonts, restrained color.
- Never use em dashes. Use commas, periods, or parentheses.
- Do not invent data. If the user gives numbers, use them; otherwise keep placeholders obvious.
- Keep dependencies minimal. Prefer core TikZ libraries (arrows.meta, positioning, calc, fit, shapes.geometric).
- Explain what you drew in one or two friendly sentences. Do not dump the whole code into chat; it is already in the document.`;

import type { DocumentEngineId, TexFlavor } from "@oleafly/backend-port";
import type { CompileTarget } from "@oleafly/compile-port";
import type { CompileSettings, WebFile } from "../protocol";

const ENGINES = new Set<DocumentEngineId>(["latex", "latexmk", "typst", "markdown", "quarto", "calepin"]);
const FLAVORS = new Set<TexFlavor>(["pdflatex", "xelatex", "lualatex", "uplatex", "platex"]);

const ROOT_MAINS = ["main.tex", "main.typ", "main.qmd", "main.md"];
const NOTES = /^(?:readme|changelog|licen[cs]e|contributing|code_of_conduct|security)(?:\.|$)/iu;

function engineOf(path: string): DocumentEngineId {
  if (/\.(?:tex|ltx|latex)$/iu.test(path)) return "latex";
  if (/\.typ$/iu.test(path)) return "typst";
  if (/\.(?:md|markdown)$/iu.test(path)) return "markdown";
  if (/\.(?:qmd|rmd)$/iu.test(path)) return "quarto";
  return "unknown";
}

function detectedMain(files: readonly WebFile[]): WebFile | null {
  const sources = files.filter(
    (file) => file.kind === "text" && engineOf(file.path) !== "unknown" && !NOTES.test(file.path.split("/").pop() ?? ""),
  );
  const root = ROOT_MAINS.map((name) => sources.find((file) => file.path === name)).find(Boolean);
  if (root) return root;
  const depth = (file: WebFile) => file.path.split("/").length;
  return [...sources].sort((a, b) => depth(a) - depth(b) || a.path.localeCompare(b.path))[0] ?? null;
}

export function compileTargetOf(settings: CompileSettings, files: readonly WebFile[]): CompileTarget | null {
  const chosen = settings.main_doc ? files.find((file) => file.fileId === settings.main_doc && file.kind === "text") : undefined;
  const main = chosen ?? detectedMain(files);
  if (!main) return null;
  const named = settings.engine as DocumentEngineId | undefined;
  const flavor = settings.tex_flavor as TexFlavor | undefined;
  return {
    mainDocument: main.path,
    engine: named && ENGINES.has(named) ? named : engineOf(main.path),
    texFlavor: flavor && FLAVORS.has(flavor) ? flavor : null,
  };
}

export function projectFileFor(path: string, files: readonly WebFile[]): WebFile | null {
  const clean = path.replaceAll("\\", "/").replace(/^(?:\.\/)+/u, "");
  if (!clean) return null;
  const texts = files.filter((file) => file.kind === "text");
  const exact = texts.find((file) => file.path === clean);
  if (exact) return exact;
  const ending = texts.filter((file) => clean.endsWith(`/${file.path}`));
  ending.sort((a, b) => b.path.length - a.path.length);
  return ending[0] ?? null;
}

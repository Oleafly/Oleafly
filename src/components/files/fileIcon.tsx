import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileType,
  Github,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { useColorDrawing } from "@/components/icons/icon-pack";
import { ColorIconSvg } from "@/components/icons/pack-icon";
import { cn } from "@/lib/utils";

const BY_EXT: Record<string, { Icon: LucideIcon; cls: string }> = {
  tex: { Icon: FileText, cls: "text-sky-500" },
  sty: { Icon: FileText, cls: "text-sky-500" },
  cls: { Icon: FileText, cls: "text-sky-500" },
  ltx: { Icon: FileText, cls: "text-sky-500" },
  typ: { Icon: FileType, cls: "text-emerald-500" },
  bib: { Icon: FileText, cls: "text-amber-500" },
  pdf: { Icon: FileText, cls: "text-red-500" },
  json: { Icon: FileJson, cls: "text-yellow-500" },
  md: { Icon: FileType, cls: "text-indigo-400" },
  markdown: { Icon: FileType, cls: "text-indigo-400" },
  qmd: { Icon: FileType, cls: "text-indigo-400" },
  rmd: { Icon: FileType, cls: "text-indigo-400" },
  css: { Icon: FileCode, cls: "text-primary" },
  scss: { Icon: FileCode, cls: "text-pink-500" },
  js: { Icon: FileCode, cls: "text-yellow-400" },
  mjs: { Icon: FileCode, cls: "text-yellow-400" },
  ts: { Icon: FileCode, cls: "text-primary" },
  tsx: { Icon: FileCode, cls: "text-primary" },
  html: { Icon: FileCode, cls: "text-orange-500" },
  xml: { Icon: FileCode, cls: "text-orange-500" },
  yml: { Icon: Settings2, cls: "text-rose-500" },
  yaml: { Icon: Settings2, cls: "text-rose-500" },
  toml: { Icon: Settings2, cls: "text-rose-500" },
  png: { Icon: FileImage, cls: "text-pink-500" },
  jpg: { Icon: FileImage, cls: "text-pink-500" },
  jpeg: { Icon: FileImage, cls: "text-pink-500" },
  gif: { Icon: FileImage, cls: "text-pink-500" },
  webp: { Icon: FileImage, cls: "text-pink-500" },
  svg: { Icon: FileImage, cls: "text-pink-500" },
  eps: { Icon: FileImage, cls: "text-pink-500" },
  zip: { Icon: FileArchive, cls: "text-amber-500" },
  gz: { Icon: FileArchive, cls: "text-amber-500" },
  tar: { Icon: FileArchive, cls: "text-amber-500" },
};

const BY_NAME: Record<string, { Icon: LucideIcon; cls: string }> = {
  ".gitignore": { Icon: Github, cls: "text-orange-500" },
  "gitignore": { Icon: Github, cls: "text-orange-500" },
  ".gitattributes": { Icon: Github, cls: "text-orange-500" },
  ".env": { Icon: FileText, cls: "text-emerald-500" },
  "license": { Icon: FileText, cls: "text-muted-foreground" },
  "readme.md": { Icon: FileType, cls: "text-indigo-400" },
  "dockerfile": { Icon: FileCode, cls: "text-primary" },
  "makefile": { Icon: FileCode, cls: "text-green-500" },
};

// The colour pack's drawing for each extension; anything else gets the plain sheet.
const COLOR_BY_EXT: Record<string, string> = {
  tex: "file-latex", sty: "file-latex", cls: "file-latex", ltx: "file-latex",
  typ: "file-typst", bib: "file-bib", pdf: "file-pdf", json: "file-json", txt: "file-text",
  md: "file-markdown", markdown: "file-markdown", qmd: "file-markdown", rmd: "file-markdown",
  css: "file-code", scss: "file-code", js: "file-code", mjs: "file-code", ts: "file-code", tsx: "file-code", xml: "file-code",
  html: "file-html", yml: "file-config", yaml: "file-config", toml: "file-config",
  png: "file-image", jpg: "file-image", jpeg: "file-image", gif: "file-image", webp: "file-image", svg: "file-image", eps: "file-image",
  zip: "file-zip", gz: "file-zip", tar: "file-zip",
};

const COLOR_BY_NAME: Record<string, string> = {
  ".gitignore": "file-git", "gitignore": "file-git", ".gitattributes": "file-git", ".env": "file-config",
  "license": "file-text", "readme.md": "file-markdown", "dockerfile": "file-code", "makefile": "file-code",
};

export function FileIcon({ name, className }: Readonly<{ name: string; className?: string }>) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot > 0 ? lower.slice(dot + 1) : "";
  const base = lower.slice(lower.lastIndexOf("/") + 1);

  const match =
    BY_NAME[base] ?? BY_NAME[lower] ?? (ext ? BY_EXT[ext] : undefined);

  const drawingName = COLOR_BY_NAME[base] ?? COLOR_BY_NAME[lower] ?? (ext ? COLOR_BY_EXT[ext] : undefined) ?? "file";
  const drawing = useColorDrawing(drawingName);
  if (drawing) return <ColorIconSvg name={drawingName} drawing={drawing} className={className} />;

  const { Icon, cls } = match ?? { Icon: File, cls: "text-muted-foreground" };
  return <Icon className={cn(className, cls)} />;
}

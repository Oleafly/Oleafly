import {
  BookMarked,
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileSliders,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Github,
  Image,
  Presentation,
  Shapes,
  Sheet,
  type LucideIcon,
} from "lucide-react";
import { isDeckPath } from "@/components/editor/deck/deck-path";
import { cn } from "@/lib/utils";

const TINT_FIRST = "[&>:first-child]:fill-current/15 dark:[&>:first-child]:fill-current/20";
const TINT_SECOND = "[&>:nth-child(2)]:fill-current/15 dark:[&>:nth-child(2)]:fill-current/20";
const TINT_ALL = "[&>*]:fill-current/15 dark:[&>*]:fill-current/20";

interface Glyph {
  readonly Icon: LucideIcon;
  readonly hue: string;
  readonly tint?: string;
}

const GLYPHS = {
  tex: { Icon: FileType, hue: "text-file-source" },
  style: { Icon: FileSliders, hue: "text-file-source" },
  typst: { Icon: FileType, hue: "text-file-typst" },
  bib: { Icon: BookMarked, hue: "text-file-prose", tint: TINT_SECOND },
  markdown: { Icon: FileText, hue: "text-file-prose" },
  pdf: { Icon: FileText, hue: "text-file-pdf" },
  image: { Icon: Image, hue: "text-file-image" },
  sheet: { Icon: Sheet, hue: "text-file-sheet" },
  board: { Icon: Shapes, hue: "text-file-image", tint: TINT_ALL },
  slides: { Icon: Presentation, hue: "text-file-code", tint: TINT_SECOND },
  code: { Icon: FileCode, hue: "text-file-code" },
  config: { Icon: FileBraces, hue: "text-file-source" },
  archive: { Icon: FileArchive, hue: "text-file-folder" },
  git: { Icon: Github, hue: "text-file-source" },
  text: { Icon: File, hue: "text-muted-foreground" },
} satisfies Record<string, Glyph>;

type GlyphKind = keyof typeof GLYPHS;

const EXTENSIONS: readonly (readonly [GlyphKind, readonly string[]])[] = [
  ["tex", ["tex", "ltx", "latex", "tikz", "dtx", "ins", "aux", "synctex", "synctex.gz"]],
  ["style", ["sty", "cls", "clo", "bst", "bbx", "cbx", "lbx"]],
  ["typst", ["typ"]],
  ["bib", ["bib", "bbl", "bcf", "blg"]],
  ["markdown", ["md", "markdown", "mdx", "qmd", "rmd"]],
  ["pdf", ["pdf"]],
  ["image", ["png", "jpg", "jpeg", "gif", "svg", "eps", "webp", "tif", "tiff", "bmp", "avif"]],
  ["sheet", ["csv", "tsv", "xlsx", "xls", "ods"]],
  ["board", ["excalidraw"]],
  [
    "code",
    ["html", "htm", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "r", "jl", "sh", "css", "scss", "lua", "sql", "ipynb"],
  ],
  ["config", ["json", "toml", "yaml", "yml", "ini", "cfg", "xml", "lock"]],
  ["archive", ["zip", "gz", "tar", "tgz", "7z"]],
];

const KIND_BY_EXTENSION = new Map(
  EXTENSIONS.flatMap(([kind, extensions]) => extensions.map((extension) => [extension, kind] as const)),
);

const KIND_BY_NAME: Readonly<Record<string, GlyphKind>> = {
  ".gitignore": "git",
  gitignore: "git",
  ".gitattributes": "git",
  ".env": "config",
  dockerfile: "code",
  makefile: "code",
};

export function fileGlyphKind(name: string): GlyphKind {
  if (isDeckPath(name)) return "slides";
  const base = (name.split("/").at(-1) ?? name).toLowerCase();
  const named = KIND_BY_NAME[base];
  if (named) return named;
  const segments = base.split(".");
  for (let index = 1; index < segments.length; index += 1) {
    const kind = KIND_BY_EXTENSION.get(segments.slice(index).join("."));
    if (kind) return kind;
  }
  return "text";
}

export function FileIcon({ name, className }: Readonly<{ name: string; className?: string }>) {
  const kind = fileGlyphKind(name);
  const { Icon, hue, tint = TINT_FIRST }: Glyph = GLYPHS[kind];
  return <Icon data-file-kind={kind} strokeWidth={1.75} className={cn(className, hue, tint)} />;
}

const BADGE_NAMES: Readonly<Record<string, string>> = { excalidraw: "draw", markdown: "md" };

export function fileBadgeLabel(name: string): string | null {
  if (isDeckPath(name)) return "DECK";
  const base = (name.split("/").at(-1) ?? name).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = base.slice(dot + 1);
  const label = BADGE_NAMES[extension] ?? extension;
  return label.length > 0 && label.length <= 5 ? label.toUpperCase() : null;
}

export function FileBadge({ name, className }: Readonly<{ name: string; className?: string }>) {
  const label = fileBadgeLabel(name);
  if (!label) {
    return (
      <span className={cn("flex w-8.5 shrink-0 justify-center", className)}>
        <FileIcon name={name} className="size-4" />
      </span>
    );
  }
  const kind = fileGlyphKind(name);
  return (
    <span
      data-file-kind={kind}
      className={cn(
        "inline-flex h-4 w-8.5 shrink-0 items-center justify-center rounded bg-current/15 text-[0.5625rem] font-bold leading-none tracking-wide dark:bg-current/20",
        GLYPHS[kind].hue,
        className,
      )}
    >
      {label}
    </span>
  );
}

export function FolderIcon({ open, className }: Readonly<{ open: boolean; className?: string }>) {
  const Icon = open ? FolderOpen : Folder;
  return <Icon strokeWidth={1.75} className={cn(className, "text-file-folder", TINT_FIRST)} />;
}

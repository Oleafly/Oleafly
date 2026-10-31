import { markdownLinkDestination } from "@oleafly/wysiwyg/link-destination";
import { isImagePath, isInsertableImagePath } from "@/lib/image-mime";
import { basename, relativeFilePath } from "@/lib/path-utils";
import { resolveProjectPath } from "@/lib/project-intelligence/source";

export type LinkLanguage = "markdown" | "typst" | "latex";

export interface FileLinkPlace {
  readonly fromFile: string;
  readonly mainDoc: string;
}

interface UrlLocation {
  readonly protocol: string;
  readonly host: string;
}

const TAURI_ORIGINS: ReadonlySet<string> = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

export function linkLanguageFor(path: string | null | undefined): LinkLanguage | null {
  if (!path) return null;
  if (/\.(?:md|markdown|qmd|rmd)$/iu.test(path)) return "markdown";
  if (/\.typ$/iu.test(path)) return "typst";
  if (/\.(?:tex|latex|ltx)$/iu.test(path)) return "latex";
  return null;
}

export function isLinkImage(language: LinkLanguage, path: string): boolean {
  return language === "markdown" ? isImagePath(path) : isInsertableImagePath(path);
}

export function fileLinkText(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function fileLinkDestination(language: LinkLanguage, target: string, place: FileLinkPlace): string {
  return relativeFilePath(language === "latex" ? place.mainDoc : place.fromFile, target);
}

/**
 * The file a link written in `activePath` is relative to: the note itself, or
 * for LaTeX the main document, since `\href` resolves from the PDF.
 */
export function linkBase(activePath: string, mainDoc: string): string {
  return linkLanguageFor(activePath) === "latex" ? mainDoc : activePath;
}

export function escapeMarkdownLinkText(text: string): string {
  return text.replaceAll(/[\\[\]*`]/gu, (character) => `\\${character}`);
}

export function escapeTypstString(text: string): string {
  return text.replaceAll(/["\\]/gu, (character) => `\\${character}`);
}

export function escapeTypstMarkup(text: string): string {
  return text.replaceAll(/[\\[\]#*_`$@<>~]/gu, (character) => `\\${character}`);
}

const LATEX_TEXT_ESCAPES: Readonly<Record<string, string>> = {
  "\\": String.raw`\textbackslash{}`,
  "^": String.raw`\^{}`,
  "~": String.raw`\~{}`,
};

export function escapeLatexText(text: string): string {
  return text.replaceAll(/[\\{}#$%&_^~]/gu, (character) => LATEX_TEXT_ESCAPES[character] ?? `\\${character}`);
}

export function escapeLatexUrl(text: string): string {
  return text.replaceAll(/[\\{}%#]/gu, (character) => `\\${character}`);
}

export interface FileLinkOptions {
  readonly text?: string;
  readonly typstHash?: boolean;
  readonly fragment?: string;
}

const NAME_ESCAPES: Readonly<Record<LinkLanguage, (text: string) => string>> = {
  markdown: escapeMarkdownLinkText,
  typst: escapeTypstMarkup,
  latex: escapeLatexText,
};

export function fileLinkSource(
  language: LinkLanguage,
  target: string,
  place: FileLinkPlace,
  options: FileLinkOptions = {},
): string {
  const destination = fileLinkDestination(language, target, place) + (options.fragment ?? "");
  const text = options.text ?? NAME_ESCAPES[language](fileLinkText(target));
  if (language === "markdown") return `[${text}](${markdownLinkDestination(destination)})`;
  if (language === "typst") {
    return `${options.typstHash === false ? "" : "#"}link("${escapeTypstString(destination)}")[${text}]`;
  }
  return String.raw`\href{${escapeLatexUrl(destination)}}{${text}}`;
}

function currentLocation(): UrlLocation | null {
  return typeof location === "undefined" ? null : location;
}

export function appUrlProjectPath(
  href: string,
  where: UrlLocation | null = currentLocation(),
): { path: string; fragment: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const origin = `${url.protocol}//${url.host}`;
  if (!TAURI_ORIGINS.has(origin) && (!where || origin !== `${where.protocol}//${where.host}`)) return null;
  try {
    const path = decodeURIComponent(url.pathname).replace(/^\/+/u, "");
    return path ? { path, fragment: decodeURIComponent(url.hash) } : null;
  } catch {
    return null;
  }
}

export function localizeAppLink(
  href: string,
  fromFile: string,
  where: UrlLocation | null = currentLocation(),
): { path: string; fragment: string } | null {
  const target = appUrlProjectPath(href, where);
  return target ? { path: relativeFilePath(fromFile, target.path), fragment: target.fragment } : null;
}

export function projectFileForHref(
  fromFile: string,
  href: string | undefined,
  where: UrlLocation | null = currentLocation(),
): { path: string; fragment: string } | null {
  if (!href || href.startsWith("#")) return null;
  const onAppOrigin = appUrlProjectPath(href, where);
  if (onAppOrigin) return onAppOrigin;
  if (href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/iu.test(href)) return null;
  const hash = href.indexOf("#");
  let decoded: string;
  try {
    decoded = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
  } catch {
    return null;
  }
  const path = resolveProjectPath(fromFile, decoded);
  return path ? { path, fragment: hash < 0 ? "" : href.slice(hash) } : null;
}

import { frontMatterValues } from "@/lib/front-matter";
import { numberedPath } from "@/lib/path-utils";

export const PROJECT_NOTES_DIR = "notes";
export const PROJECT_NOTE_ASSETS_DIR = `${PROJECT_NOTES_DIR}/assets`;
export const NOTE_FILE_KIND = "note";
export const NOTE_FILE = "note.md";

const FRONT_MATTER_CHARS = 4 * 1024;
const NAME_CHARS = 80;
const MARKDOWN_FILE = /\.md$/iu;
const UNSAFE_NAME = /[\\/:*?"<>|\p{Cc}]/gu;
const RESERVED_STEM = /^(?:CON|PRN|AUX|NUL|(?:COM|LPT)[1-9\u00B9\u00B2\u00B3])$/u;
const SPACE = /\s/u;

export function foldPath(path: string): string {
  let folded = "";
  for (const character of path.normalize("NFC")) {
    const upper = character.toUpperCase();
    folded += (Array.from(upper).length === 1 ? upper : character).toLowerCase();
  }
  return folded;
}

const IGNORABLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x206a, 0x206f],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
];

export function isIgnorableCodePoint(code: number): boolean {
  return IGNORABLE_RANGES.some(([from, to]) => code >= from && code <= to);
}

function withoutIgnorable(text: string): string {
  return Array.from(text)
    .filter((character) => !isIgnorableCodePoint(character.codePointAt(0) ?? 0))
    .join("");
}

export function isWindowsReservedComponent(component: string): boolean {
  const stem = component.split(".")[0] ?? "";
  return RESERVED_STEM.test(stem.replaceAll(/[a-z]/gu, (letter) => letter.toUpperCase()));
}

export function projectNotesFolder(paths: Iterable<string>): string {
  for (const path of paths) {
    const slash = path.indexOf("/");
    const top = slash < 0 ? path : path.slice(0, slash);
    if (foldPath(top) === PROJECT_NOTES_DIR) return top;
  }
  return PROJECT_NOTES_DIR;
}

export interface NoteFileFacts {
  title: string | null;
  id: string | null;
  icon: string | null;
  color: string | null;
}

export function isMarkdownFile(path: string): boolean {
  return MARKDOWN_FILE.test(path);
}

export function isProjectNotePath(path: string): boolean {
  if (path.charAt(PROJECT_NOTES_DIR.length) !== "/" || !isMarkdownFile(path)) return false;
  const folded = foldPath(path);
  return folded.startsWith(`${PROJECT_NOTES_DIR}/`) && !folded.startsWith(`${PROJECT_NOTE_ASSETS_DIR}/`);
}

export function isProjectNoteAssetPath(path: string): boolean {
  return foldPath(path).startsWith(`${PROJECT_NOTE_ASSETS_DIR}/`);
}

export function noteFileFacts(text: string | null | undefined): NoteFileFacts | null {
  if (!text) return null;
  const values = frontMatterValues(text.slice(0, FRONT_MATTER_CHARS));
  if (values.get("kind") !== NOTE_FILE_KIND) return null;
  return {
    title: values.get("title") ?? null,
    id: values.get("id") ?? null,
    icon: values.get("icon") ?? null,
    color: values.get("color") ?? null,
  };
}

export function declaresNoteFile(text: string | null | undefined): boolean {
  return noteFileFacts(text) !== null;
}

export interface NoteFileContext {
  notes: boolean;
  projectKind: string | null;
}

export function isEditorNoteFile(path: string | null, text: string | null | undefined, context: NoteFileContext): boolean {
  return context.notes && context.projectKind !== "note" && path !== null && isProjectNotePath(path) && declaresNoteFile(text);
}

export function noteFileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(MARKDOWN_FILE, "");
}

function isDotOrSpace(character: string): boolean {
  return character === "." || SPACE.test(character);
}

function trimDotsAndSpaces(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isDotOrSpace(text.charAt(start))) start += 1;
  while (end > start && isDotOrSpace(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

function portableStem(text: string): string {
  return trimDotsAndSpaces(withoutIgnorable(text.normalize("NFC")).replaceAll(UNSAFE_NAME, " ").replaceAll(/\s+/gu, " "));
}

export function noteFileName(title: string, fallback: string): string {
  const stem = portableStem(Array.from(portableStem(title)).slice(0, NAME_CHARS).join(""));
  if (!stem) return fallback;
  if (!isWindowsReservedComponent(stem)) return stem;
  const dot = stem.indexOf(".");
  return dot < 0 ? `${stem} note` : `${stem.slice(0, dot)} note${stem.slice(dot)}`;
}

function freeNotePath(folder: string, stem: string, taken: readonly string[]): string {
  const used = new Set(taken.map(foldPath));
  return numberedPath(`${folder}${stem}.md`, (path) => used.has(foldPath(path)));
}

export function projectNoteFilePath(title: string, taken: Iterable<string>, fallback: string): string {
  const paths = Array.from(taken);
  return freeNotePath(`${projectNotesFolder(paths)}/`, noteFileName(title, fallback), paths);
}

export function renamedNotePath(path: string, title: string, taken: Iterable<string>, fallback: string): string {
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  const next = freeNotePath(folder, noteFileName(title, fallback), Array.from(taken));
  return next === path ? path : next;
}

export function noteRelativePath(notePath: string, relative: string): string | null {
  const slash = notePath.lastIndexOf("/");
  const parts = slash < 0 ? [] : notePath.slice(0, slash).split("/");
  for (const segment of relative.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length === 0 ? null : parts.join("/");
}

export function projectNoteKey(projectId: string, path: string): string {
  return `project-note:${projectId}:${path}`;
}

import { frontMatterValues } from "@/lib/front-matter";

export const PROJECT_NOTES_DIR = "notes";
export const PROJECT_NOTE_ASSETS_DIR = `${PROJECT_NOTES_DIR}/assets`;
export const NOTE_FILE_KIND = "note";
export const NOTE_FILE = "note.md";

const FRONT_MATTER_CHARS = 4 * 1024;
const NAME_CHARS = 80;
const MARKDOWN_FILE = /\.md$/iu;
const UNSAFE_NAME = /[\\/:*?"<>|\p{Cc}]/gu;
const RESERVED_STEM = /^(?:CON|PRN|AUX|NUL|(?:COM|LPT)[1-9\u00B9\u00B2\u00B3])$/u;
const UNNORMALIZED_EDGE = /^[.\s]+|[.\s]+$/gu;

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
  return RESERVED_STEM.test(stem.replace(/[a-z]/gu, (letter) => letter.toUpperCase()));
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
  const folded = foldPath(path);
  return (
    folded.startsWith(`${PROJECT_NOTES_DIR}/`) &&
    !folded.startsWith(`${PROJECT_NOTE_ASSETS_DIR}/`) &&
    isMarkdownFile(path)
  );
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

export function noteFileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(MARKDOWN_FILE, "");
}

function portableStem(text: string): string {
  return withoutIgnorable(text.normalize("NFC"))
    .replace(UNSAFE_NAME, " ")
    .replace(/\s+/gu, " ")
    .replace(UNNORMALIZED_EDGE, "");
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
  for (let attempt = 1; ; attempt += 1) {
    const path = `${folder}${attempt === 1 ? stem : `${stem} ${attempt}`}.md`;
    if (!used.has(foldPath(path))) return path;
  }
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

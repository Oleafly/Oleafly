import enEditor from "../../../src/i18n/locales/en/editor.json" with { type: "json" };
import { setEditorTranslator, type EditorMessageKey } from "./messages";

type Catalog = Record<string, unknown>;

function read(path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>((node, part) => (node as Catalog | undefined)?.[part], enEditor.package);
  return typeof value === "string" ? value : "";
}

function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/gu, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function englishEditorMessage(
  key: EditorMessageKey,
  params?: Record<string, string | number>,
): string {
  const count = params?.count;
  if (typeof count === "number") {
    const plural = read(`${key}_${count === 1 ? "one" : "other"}`);
    if (plural) return fill(plural, params);
  }
  return fill(read(key), params);
}

export function installEnglishEditorMessages(): void {
  setEditorTranslator(englishEditorMessage);
}

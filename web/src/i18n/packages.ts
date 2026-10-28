import type { EditorTranslator } from "@oleafly/editor";
import type { PreviewTranslator } from "@oleafly/preview";
import editor from "@/i18n/locales/en/editor.json";
import preview from "@/i18n/locales/en/preview.json";
import { webI18n } from "./index";

type Untyped = (key: string, params?: Record<string, unknown>) => string;

let installed = false;

export function installPackageMessages(): void {
  if (installed) return;
  installed = true;
  webI18n.addResourceBundle("en", "editor", { package: editor.package }, true, true);
  webI18n.addResourceBundle("en", "preview", { package: preview.package }, true, true);
}

function translate(key: string, params?: Record<string, unknown>): string {
  installPackageMessages();
  return (webI18n.t as unknown as Untyped)(key, params);
}

export const editorMessage: EditorTranslator = (key, params) => translate(`editor:package.${key}`, params);

export const previewMessage: PreviewTranslator = (key, params) => translate(`preview:package.${key}`, params);

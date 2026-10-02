import { testCatalogTranslator } from "@oleafly/i18n-contract/testing";
import { setEditorTranslator, type EditorMessageKey, type EditorTranslator } from "./messages";

export const englishEditorMessage: EditorTranslator =
  testCatalogTranslator<EditorMessageKey>("editor");

export function installEnglishEditorMessages(): void {
  setEditorTranslator(englishEditorMessage);
}

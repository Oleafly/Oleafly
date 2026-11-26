import { createTranslatorSlot, type Translator } from "@oleafly/i18n-contract";
import type { EDITOR_MESSAGE_KEYS } from "./message-keys";

export type EditorMessageKey = (typeof EDITOR_MESSAGE_KEYS)[number];

export type EditorTranslator = Translator<EditorMessageKey>;

const editorTranslator = createTranslatorSlot<EditorMessageKey>();

export const setEditorTranslator = editorTranslator.install;

export const editorMessage = editorTranslator.translate;

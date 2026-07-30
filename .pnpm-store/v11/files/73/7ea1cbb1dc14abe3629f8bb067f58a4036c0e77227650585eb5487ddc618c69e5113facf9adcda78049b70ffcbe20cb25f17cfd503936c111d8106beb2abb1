import _default from "./resources/en/chat.mjs";
import _default$1 from "./resources/en/common.mjs";
import _default$2 from "./resources/en/editableMessage.mjs";
import _default$3 from "./resources/en/emojiPicker.mjs";
import _default$4 from "./resources/en/form.mjs";
import _default$5 from "./resources/en/hotkey.mjs";
import _default$6 from "./resources/en/image.mjs";
import _default$7 from "./resources/en/messageModal.mjs";
import _default$8 from "./resources/en/sideNav.mjs";
//#region src/i18n/types.d.ts
type Locale = string;
type BuiltinTranslationResources = typeof _default & typeof _default$1 & typeof _default$2 & typeof _default$3 & typeof _default$4 & typeof _default$5 & typeof _default$6 & typeof _default$7 & typeof _default$8;
type TranslationKey = keyof BuiltinTranslationResources;
type TranslationValue = string;
/**
 * A (partial) dictionary of translations.
 *
 * Note: it's intentionally Partial so feature-level modules can pass only their own keys as
 * fallback resources (e.g. `useTranslation(editableMessageMessages)`).
 */
type TranslationResources = Partial<Record<TranslationKey, TranslationValue>>;
type TranslationResourcesMap = TranslationResources[] | Record<string, TranslationResources>;
type TranslationResourcesInput = TranslationResourcesMap | Promise<TranslationResourcesMap>;
type I18nContextValue = {
  locale: Locale;
  t: (key: TranslationKey) => string;
};
//#endregion
export { I18nContextValue, Locale, TranslationKey, TranslationResources, TranslationResourcesInput, TranslationResourcesMap, TranslationValue };
//# sourceMappingURL=types.d.mts.map
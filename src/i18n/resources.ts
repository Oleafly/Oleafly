import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enSettings from "./locales/en/settings.json";
import esCommon from "./locales/es/common.json";
import esErrors from "./locales/es/errors.json";
import esSettings from "./locales/es/settings.json";
import frCommon from "./locales/fr/common.json";
import frErrors from "./locales/fr/errors.json";
import frSettings from "./locales/fr/settings.json";
import zhCommon from "./locales/zh/common.json";
import zhErrors from "./locales/zh/errors.json";
import zhSettings from "./locales/zh/settings.json";

export const resources = {
  en: {
    common: enCommon,
    errors: enErrors,
    settings: enSettings,
  },
  es: {
    common: esCommon,
    errors: esErrors,
    settings: esSettings,
  },
  fr: {
    common: frCommon,
    errors: frErrors,
    settings: frSettings,
  },
  zh: {
    common: zhCommon,
    errors: zhErrors,
    settings: zhSettings,
  },
} as const;

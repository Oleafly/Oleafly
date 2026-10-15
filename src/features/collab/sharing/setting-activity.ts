import type { useTranslation } from "react-i18next";
import { currentLocale } from "@/i18n";
import { dictionaryLabel } from "@/lib/proofreading/dictionary-catalog";
import type { CollabSettingNotice } from "@/lib/tauri";

type CollabT = ReturnType<typeof useTranslation<["collab"]>>["t"];
type CompilerChange = Extract<CollabSettingNotice, { kind: "compiler" }>;

function compilerName(change: CompilerChange, t: CollabT): string {
  if (change.engine === "typst") return t(($) => $.collab.activity.settings.compilers.typst);
  if (change.engine === "markdown") return t(($) => $.collab.activity.settings.compilers.pandoc);
  if (change.engine !== "latexmk") return t(($) => $.collab.activity.settings.compilers.tectonic);
  switch (change.flavor) {
    case "pdflatex":
      return t(($) => $.collab.activity.settings.compilers.pdflatex);
    case "xelatex":
      return t(($) => $.collab.activity.settings.compilers.xelatex);
    case "lualatex":
      return t(($) => $.collab.activity.settings.compilers.lualatex);
    case "uplatex":
      return t(($) => $.collab.activity.settings.compilers.uplatex);
    case "platex":
      return t(($) => $.collab.activity.settings.compilers.platex);
    default:
      return t(($) => $.collab.activity.settings.compilers.auto);
  }
}

function languageName(locale: string): string {
  return dictionaryLabel({ id: locale, language: locale, region: null }, currentLocale());
}

// `byPerson` is false for a change that came with no account, such as the
// main document following its file to the name the shared layout gave it.
export function settingActivityText(change: CollabSettingNotice, name: string, t: CollabT, byPerson = true): string {
  switch (change.kind) {
    case "mainDocument":
      return byPerson
        ? t(($) => $.collab.activity.settings.mainDocument, { name, path: change.path })
        : t(($) => $.collab.activity.settings.mainDocumentNow, { path: change.path });
    case "compiler":
      return t(($) => $.collab.activity.settings.compiler, { name, compiler: compilerName(change, t) });
    case "spellingLanguage":
      return change.locale
        ? t(($) => $.collab.activity.settings.spellingLanguage, { name, language: languageName(change.locale) })
        : t(($) => $.collab.activity.settings.spellingCleared, { name });
    case "typstVersion":
      return change.version
        ? t(($) => $.collab.activity.settings.typstVersion, { name, version: change.version })
        : t(($) => $.collab.activity.settings.typstDefault, { name });
    case "typstOptions":
      return t(($) => $.collab.activity.settings.typstOptions, { name });
  }
}

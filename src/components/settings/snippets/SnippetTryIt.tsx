import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EditorView } from "@codemirror/view";
import { CircleCheck, CircleMinus } from "lucide-react";
import { languageForPath, type SnippetPort } from "@oleafly/editor";
import { snippetEditorExtensions } from "@oleafly/editor/snippets/runtime";
import { buildLibrary, type Place, placeAllows, type SnippetLanguage, type SnippetLibrary, type SnippetRecord } from "@oleafly/snippets";
import { CodeField } from "@/components/tools/CodeField";
import { Chip } from "@/components/ui/chip";
import { createSnippetPort } from "@/features/snippets/port";
import { isMathPlace, languageLabel } from "@/features/snippets/records";
import { TONES } from "@/components/ui/tones";
import { useEditorThemeId } from "@/hooks/use-editor-theme";
import { SAMPLE_PATH } from "./SnippetBodyEditor";

type TryPlace = "text" | "math";
type MathPlace = "inline-math" | "display-math";

const MATH_DOCS: Partial<Record<SnippetLanguage, Readonly<Record<MathPlace, string>>>> = {
  latex: { "inline-math": "$|$", "display-math": "\\[|\\]" },
  typst: { "inline-math": "$|$", "display-math": "$ | $" },
  markdown: { "inline-math": "$|$", "display-math": "$$|$$" },
};

function mathPlaceOf(record: SnippetRecord): MathPlace {
  return record.place === "display-math" ? "display-math" : "inline-math";
}

const libraries = new WeakMap<SnippetRecord, SnippetLibrary>();

function libraryOf(record: SnippetRecord): SnippetLibrary {
  let library = libraries.get(record);
  if (!library) {
    library = buildLibrary({
      files: [{ collection: record.collection, records: [record], problems: [] }],
      disabledCollections: new Set(),
      overrides: [],
      disabledRegex: new Set(),
    });
    libraries.set(record, library);
  }
  return library;
}

function tryPort(record: () => SnippetRecord, language: SnippetLanguage): SnippetPort {
  const path = SAMPLE_PATH[language];
  return {
    ...createSnippetPort(() => path),
    library: () => libraryOf(record()),
    language: () => language,
    editSnippet: undefined,
    enabled: () => ({ list: true, tab: true, auto: true, hint: true }),
    recordUse: () => undefined,
    onAutoExpanded: () => undefined,
    onHandTypedFraction: () => undefined,
    reportSlowRegex: () => undefined,
  };
}

function firesIn(record: SnippetRecord, language: SnippetLanguage, place: TryPlace): "language" | "place" | null {
  if (record.languages !== "any" && !record.languages.includes(language)) return "language";
  return placeAllows(record, place === "text" ? "text" : mathPlaceOf(record)) ? null : "place";
}

export function SnippetTryIt({
  record,
  languages,
}: Readonly<{ record: SnippetRecord; languages: readonly SnippetLanguage[] }>) {
  const { t } = useTranslation(["settings"]);
  const themeId = useEditorThemeId();
  const [chosen, setChosen] = useState<SnippetLanguage>(languages[0] ?? "latex");
  const language = languages.includes(chosen) ? chosen : (languages[0] ?? "latex");
  const mathDoc = MATH_DOCS[language]?.[mathPlaceOf(record)];
  const [picked, setPicked] = useState<{ readonly where: Place; readonly place: TryPlace } | null>(null);
  const startPlace: TryPlace = isMathPlace(record.place) ? "math" : "text";
  const place: TryPlace = picked?.where === record.place ? picked.place : startPlace;
  const setPlace = (next: TryPlace) => setPicked({ where: record.place, place: next });
  const activePlace: TryPlace = mathDoc ? place : "text";
  const latest = useRef(record);
  useLayoutEffect(() => {
    latest.current = record;
  }, [record]);
  const port = useMemo(() => tryPort(() => latest.current, language), [language]);
  const extensions = useCallback(() => [languageForPath(SAMPLE_PATH[language]) ?? [], snippetEditorExtensions(port)], [port, language]);
  const doc = activePlace === "math" && mathDoc ? mathDoc : "|";
  const caret = doc.indexOf("|");
  const blocked = firesIn(record, language, activePlace);
  const trigger = record.trigger ?? record.aliases[0] ?? null;
  const resetKey = JSON.stringify([
    language,
    activePlace,
    record.bodies,
    record.trigger,
    record.regex?.source ?? null,
    record.aliases,
    record.expand,
    record.place,
    record.inWord,
    record.lineStart,
    record.languages,
  ]);

  const placeView = useCallback(
    (view: EditorView | null) => {
      if (view) view.dispatch({ selection: { anchor: caret } });
    },
    [caret],
  );

  const how = (() => {
    if (!trigger) return t(($) => $.settings.snippets.editor.tryIt.noTrigger);
    if (record.expand === "auto") return t(($) => $.settings.snippets.editor.tryIt.howAuto, { trigger });
    if (record.expand === "tab") return t(($) => $.settings.snippets.editor.tryIt.howTab, { trigger });
    return t(($) => $.settings.snippets.editor.tryIt.howList, { trigger });
  })();

  return (
    <div className="space-y-2 rounded-xl border bg-card/60 p-4" data-testid="snippet-try-it">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t(($) => $.settings.snippets.editor.tryIt.title)}</span>
        <span className="text-xs text-muted-foreground">{how}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {languages.length > 1
            ? languages.map((option) => (
                <Chip key={option} pressed={option === language} onClick={() => setChosen(option)}>
                  {languageLabel(option)}
                </Chip>
              ))
            : null}
          {mathDoc ? (
            <>
              <Chip pressed={activePlace === "text"} onClick={() => setPlace("text")}>
                {t(($) => $.settings.snippets.editor.tryIt.inText)}
              </Chip>
              <Chip pressed={activePlace === "math"} onClick={() => setPlace("math")}>
                {t(($) => $.settings.snippets.editor.tryIt.inMath)}
              </Chip>
            </>
          ) : null}
        </div>
      </div>
      <CodeField
        key={resetKey}
        value={doc.slice(0, caret) + doc.slice(caret + 1)}
        language={extensions}
        themeId={themeId}
        ariaLabel={t(($) => $.settings.snippets.editor.tryIt.title)}
        onView={placeView}
        testId="snippet-try-it-editor"
        className="min-h-16 overflow-auto rounded-md border bg-background text-xs"
      />
      {blocked === null ? (
        <p className={`flex items-center gap-1.5 text-xs ${TONES.emerald.text}`} data-testid="snippet-try-it-fires">
          <CircleCheck aria-hidden className="size-3.5" />
          {t(($) => $.settings.snippets.editor.tryIt.fires, {
            language: languageLabel(language),
            place: activePlace === "math" ? t(($) => $.settings.snippets.editor.tryIt.inMath) : t(($) => $.settings.snippets.editor.tryIt.inText),
          })}
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="snippet-try-it-blocked">
          <CircleMinus aria-hidden className="size-3.5" />
          {blocked === "language"
            ? t(($) => $.settings.snippets.editor.tryIt.notLanguage, { language: languageLabel(language) })
            : t(($) => $.settings.snippets.editor.tryIt.notPlace, {
                place: activePlace === "math" ? t(($) => $.settings.snippets.editor.tryIt.inMath) : t(($) => $.settings.snippets.editor.tryIt.inText),
              })}
        </p>
      )}
    </div>
  );
}

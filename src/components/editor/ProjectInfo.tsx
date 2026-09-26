import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import type { DictionaryInfo } from "@oleafly/backend-port";
import type { ProofreadingSurface } from "@oleafly/editor";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  collectProjectInfo,
  type ProjectInfoSnapshot,
} from "@/components/editor/project-info-data";
import { currentLocale } from "@/i18n";
import { EMPTY_DOCUMENT_STATS } from "@/lib/document-stats";
import { formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import {
  dictionaryLabel,
  effectiveDictionaryLocale,
  isEnglishDictionaryLocale,
  loadDictionaryCatalog,
  subscribeDictionaryCatalog,
} from "@/lib/proofreading/dictionary-catalog";
import { notifyError } from "@/lib/toast";
import { setProjectDictionaryLocaleCmd } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";
import {
  useLanguageServiceRuntimeUnavailable,
  useLanguageServiceSetupOffer,
} from "./LanguageServiceRuntimeBoundary";

const APP_SETTING = "__app__";

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

function SectionLabel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="px-0.5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 first:pt-0">
      {children}
    </p>
  );
}

function StatRow({
  label,
  value,
  indent,
}: Readonly<{
  label: string;
  value: number | string;
  indent?: boolean;
}>) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span
        className={cn(
          "truncate text-muted-foreground",
          indent && "pl-3 text-xs text-muted-foreground/80",
        )}
      >
        {label}
      </span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">
        {typeof value === "number" ? formatNumber(value) : value}
      </span>
    </div>
  );
}

function useDictionaryCatalog(): DictionaryInfo[] {
  const [entries, setEntries] = useState<DictionaryInfo[]>([]);
  useEffect(() => {
    let live = true;
    const unsubscribe = subscribeDictionaryCatalog((next) => {
      if (live) setEntries(next);
    });
    loadDictionaryCatalog()
      .then((next) => {
        if (live) setEntries(next);
      })
      .catch((error) => void logError("list spelling dictionaries", error));
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return entries;
}

function useEffectiveDictionaryLocale(): string {
  const project = useFilesStore((state) => state.projectDictionaryLocale);
  const global = useSettingsStore((state) => state.dictionaryLocale);
  return effectiveDictionaryLocale({ project, global });
}

function ProofreadingNote({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground/70">
      {children}
    </p>
  );
}

function ProofreadingSection({ surface }: Readonly<{ surface: ProofreadingSurface }>) {
  const { t } = useTranslation(["common", "editor"]);
  const status = useProofreadingStore((state) => state[surface]);
  const spellcheck = useSettingsStore((state) => state.spellcheck);
  const grammar = useSettingsStore((state) => state.harper);
  const entries = useDictionaryCatalog();
  const locale = useEffectiveDictionaryLocale();
  const missingEntry =
    spellcheck && status.activeDictionaryLocale !== locale
      ? entries.find(
          (entry) => entry.id === locale && entry.state === "available",
        )
      : undefined;
  const grammarEnglishOnly = grammar && !isEnglishDictionaryLocale(locale);
  const missingNote = missingEntry ? (
    <ProofreadingNote>
      {t(($) => $.editor.projectInfo.dictionaryMissing, {
        name: dictionaryLabel(missingEntry, currentLocale()),
      })}
    </ProofreadingNote>
  ) : null;
  const grammarNote = grammarEnglishOnly ? (
    <ProofreadingNote>
      {t(($) => $.editor.projectInfo.grammarEnglishOnly)}
    </ProofreadingNote>
  ) : null;

  if (!spellcheck && !grammar) {
    return (
      <StatRow
        label={t(($) => $.editor.projectInfo.proofreading)}
        value={t(($) => $.editor.projectInfo.proofreadingOff)}
      />
    );
  }
  if (status.phase === "idle" || status.phase === "loading") {
    return (
      <StatRow
        label={t(($) => $.editor.projectInfo.proofreading)}
        value={t(($) => $.editor.projectInfo.proofreadingChecking)}
      />
    );
  }
  if (status.phase !== "ready" && status.phase !== "partial") {
    const unavailableReason = () => {
      if (status.phase === "too_large") return t(($) => $.editor.proofreading.tooLarge);
      if (status.phase === "unsupported") {
        return grammarEnglishOnly
          ? t(($) => $.editor.projectInfo.grammarEnglishOnly)
          : t(($) => $.editor.proofreading.unsupported);
      }
      if (status.phase === "error") return t(($) => $.editor.proofreading.error);
      return t(($) => $.editor.proofreading.unavailable);
    };
    return (
      <>
        <StatRow
          label={t(($) => $.editor.projectInfo.proofreading)}
          value={t(($) => $.editor.projectInfo.proofreadingUnavailable)}
        />
        {status.phase === "unavailable" && missingNote ? (
          missingNote
        ) : (
          <ProofreadingNote>{unavailableReason()}</ProofreadingNote>
        )}
      </>
    );
  }

  let spelling = 0;
  let style = 0;
  for (const diagnostic of status.diagnostics) {
    if (diagnostic.source === "hunspell") spelling++;
    else style++;
  }

  const notChecked = t(($) => $.editor.projectInfo.notChecked);
  const spellingSkipped =
    Boolean(missingEntry) ||
    (status.phase === "partial" && !status.activeDictionaryLocale);

  return (
    <>
      <StatRow label={t(($) => $.editor.projectInfo.issues)} value={status.diagnosticCount} />
      {spellcheck ? (
        <StatRow
          indent
          label={t(($) => $.editor.projectInfo.spelling)}
          value={spellingSkipped ? notChecked : spelling}
        />
      ) : null}
      {grammar ? (
        <StatRow
          indent
          label={t(($) => $.editor.projectInfo.grammarAndStyle)}
          value={grammarEnglishOnly ? notChecked : style}
        />
      ) : null}
      {status.truncated ? (
        <ProofreadingNote>
          {t(($) => $.editor.projectInfo.findingsTruncated)}
        </ProofreadingNote>
      ) : null}
      {missingNote}
      {grammarNote}
    </>
  );
}

function LanguageRuntimeNotice() {
  const { t } = useTranslation(["intelligence"]);
  const unavailable = useLanguageServiceRuntimeUnavailable();
  if (!unavailable) return null;
  return (
    <div data-testid="language-runtime-unavailable" className="space-y-1.5 pt-3">
      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        {t(($) => $.intelligence.languageService.runtimeUnavailable)}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={() => window.location.reload()}
      >
        {t(($) => $.intelligence.languageService.reloadApp)}
      </Button>
    </div>
  );
}

function LanguageSetupNotice() {
  const { t } = useTranslation(["intelligence"]);
  const openSetup = useLanguageServiceSetupOffer();
  const setWordCountOpen = useSettingsStore((state) => state.setWordCountOpen);
  if (!openSetup) return null;
  return (
    <div data-testid="language-service-setup" className="space-y-1.5 pt-3">
      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        {t(($) => $.intelligence.languageService.setupRequired)}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={() => {
          setWordCountOpen(false);
          openSetup();
        }}
      >
        {t(($) => $.intelligence.languageService.setUp)}
      </Button>
    </div>
  );
}

function ProjectSpellLanguage() {
  const { t } = useTranslation(["common", "editor"]);
  const projectId = useFilesStore((state) => state.projectId);
  const projectLocale = useFilesStore((state) => state.projectDictionaryLocale);
  const spellcheck = useSettingsStore((state) => state.spellcheck);
  const entries = useDictionaryCatalog();
  const [busy, setBusy] = useState(false);

  const choose = useCallback(
    async (value: string) => {
      if (!projectId) return;
      setBusy(true);
      try {
        const meta = await setProjectDictionaryLocaleCmd(
          projectId,
          value === APP_SETTING ? null : value,
        );
        if (useFilesStore.getState().projectId !== projectId) return;
        useFilesStore.setState({
          projectDictionaryLocale: meta.dictionary_locale ?? null,
        });
      } catch (error) {
        notifyError(
          "set the spelling language",
          error,
          t(($) => $.editor.projectInfo.spellLanguageFailed),
        );
      } finally {
        setBusy(false);
      }
    },
    [projectId, t],
  );

  if (!spellcheck || !projectId) return null;

  const uiLocale = currentLocale();
  const usable = entries.filter(
    (entry) => entry.state !== "available" || entry.id === projectLocale,
  );

  return (
    <>
      <SectionLabel>{t(($) => $.editor.projectInfo.spellLanguage)}</SectionLabel>
      <Select
        value={projectLocale ?? APP_SETTING}
        onValueChange={(value) => void choose(value)}
        disabled={busy}
      >
        <SelectTrigger
          data-testid="project-dictionary-locale"
          aria-label={t(($) => $.editor.projectInfo.spellLanguageAriaLabel)}
          className="h-8 w-full text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[100] max-h-[280px]">
          <SelectItem value={APP_SETTING} data-dictionary-id={APP_SETTING}>
            {t(($) => $.editor.projectInfo.spellLanguageAppSetting)}
          </SelectItem>
          {usable.map((entry) => {
            const label =
              entry.state === "available"
                ? t(($) => $.editor.projectInfo.spellLanguageNotDownloaded, {
                    name: dictionaryLabel(entry, uiLocale),
                  })
                : dictionaryLabel(entry, uiLocale);
            return (
              <SelectItem
                key={entry.id}
                value={entry.id}
                data-dictionary-id={entry.id}
                data-label={label}
              >
                {label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground/70">
        {t(($) => $.editor.projectInfo.spellLanguageHint)}
      </p>
    </>
  );
}

export function ProjectInfoContent({
  snapshot,
  surface,
}: Readonly<{
  snapshot: ProjectInfoSnapshot | null;
  surface: ProofreadingSurface;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const activePath = useFilesStore((state) => state.activePath);
  const stats = snapshot?.stats ?? EMPTY_DOCUMENT_STATS;

  let rootSummary: string;
  if (!snapshot) {
    rootSummary = t(($) => $.editor.projectInfo.counting);
  } else if (snapshot.fileCount > 1) {
    rootSummary = t(($) => $.editor.projectInfo.fileSummary, {
      count: snapshot.fileCount,
      root: basename(snapshot.root),
    });
  } else {
    rootSummary = basename(snapshot.root);
  }

  return (
    <>
      <p className="text-sm font-semibold text-foreground">{t(($) => $.editor.projectInfo.heading)}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{rootSummary}</p>

      {snapshot ? (
        <>
          <SectionLabel>{t(($) => $.editor.projectInfo.document)}</SectionLabel>
          <div className="divide-y divide-border/60">
            <StatRow label={t(($) => $.editor.projectInfo.words)} value={stats.words} />
            <StatRow indent label={t(($) => $.editor.projectInfo.inText)} value={stats.wordsInText} />
            <StatRow indent label={t(($) => $.editor.projectInfo.inHeaders)} value={stats.wordsInHeaders} />
            <StatRow indent label={t(($) => $.editor.projectInfo.outsideText)} value={stats.wordsOutsideText} />
            <StatRow label={t(($) => $.editor.projectInfo.headers)} value={stats.headers} />
            <StatRow label={t(($) => $.editor.projectInfo.figures)} value={stats.figures} />
            <StatRow label={t(($) => $.editor.projectInfo.mathInline)} value={stats.mathInline} />
            <StatRow label={t(($) => $.editor.projectInfo.mathDisplayed)} value={stats.mathDisplayed} />
            <StatRow label={t(($) => $.editor.projectInfo.characters)} value={stats.characters} />
            <StatRow label={t(($) => $.editor.projectInfo.lines)} value={stats.lines} />
            {snapshot.selectionWords !== null ? (
              <StatRow label={t(($) => $.editor.projectInfo.selection)} value={snapshot.selectionWords} />
            ) : null}
          </div>
          {snapshot.unreadable.length > 0 ? (
            <p className="pt-2 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
              {t(($) => $.editor.projectInfo.unreadable, {
                count: snapshot.unreadable.length,
              })}
            </p>
          ) : null}

          <SectionLabel>
            {activePath
              ? t(($) => $.editor.projectInfo.proofreadingForFile, { name: basename(activePath) })
              : t(($) => $.editor.projectInfo.proofreading)}
          </SectionLabel>
          <div className="divide-y divide-border/60">
            <ProofreadingSection surface={surface} />
          </div>
          <ProjectSpellLanguage />
          <LanguageSetupNotice />
          <LanguageRuntimeNotice />
        </>
      ) : (
        <div className="py-6 text-center text-xs text-muted-foreground/70">
          {t(($) => $.editor.projectInfo.countingDocument)}
        </div>
      )}
    </>
  );
}

/**
 * Toolbar entry point. Replaces the old Word count popover and the floating
 * proofreading badge that used to sit over the document: one place answers
 * "how big is this and what is wrong with it".
 */
export function ProjectInfoButton({ surface }: Readonly<{ surface: ProofreadingSurface }>) {
  const { t } = useTranslation(["common", "editor"]);
  const [snapshot, setSnapshot] = useState<ProjectInfoSnapshot | null>(null);
  const setupOffered = useLanguageServiceSetupOffer() !== null;
  // Reopening while a previous read is still in flight must not paint that
  // older answer over the newer one.
  const generationRef = useRef(0);

  const load = useCallback((open: boolean) => {
    const generation = ++generationRef.current;
    if (!open) return;
    setSnapshot(null);
    void collectProjectInfo()
      .then((next) => {
        if (generationRef.current === generation) setSnapshot(next);
      })
      .catch(() => {
        if (generationRef.current === generation) {
          setSnapshot({
            root: "",
            fileCount: 0,
            unreadable: [],
            stats: EMPTY_DOCUMENT_STATS,
            selectionWords: null,
          });
        }
      });
  }, []);

  return (
    <Popover
      ariaLabel={t(($) => $.editor.projectInfo.trigger)}
      align="right"
      // A panel you read, not a menu you pick from: clicking a number to select
      // it must not dismiss the thing you are reading.
      closeOnClick={false}
      className="w-64 p-3"
      trigger={
        <span className="relative inline-flex">
          <Info className="size-4" />
          {setupOffered ? (
            <span
              data-testid="project-info-setup-marker"
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </span>
      }
      onOpenChange={load}
    >
      <ProjectInfoContent snapshot={snapshot} surface={surface} />
    </Popover>
  );
}

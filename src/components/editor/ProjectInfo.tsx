import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import type { ProofreadingSurface } from "@oleafly/editor";
import { Popover } from "@/components/ui/popover";
import {
  collectProjectInfo,
  type ProjectInfoSnapshot,
} from "@/components/editor/project-info-data";
import { EMPTY_DOCUMENT_STATS } from "@/lib/document-stats";
import { formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

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

function ProofreadingSection({ surface }: Readonly<{ surface: ProofreadingSurface }>) {
  const { t } = useTranslation(["common", "editor"]);
  const status = useProofreadingStore((state) => state[surface]);
  const spellcheck = useSettingsStore((state) => state.spellcheck);
  const grammar = useSettingsStore((state) => state.harper);

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
    // too_large / unsupported / error / unavailable all already raise a toast
    // that explains itself; the panel only has to stop claiming a count.
    return (
      <StatRow
        label={t(($) => $.editor.projectInfo.proofreading)}
        value={t(($) => $.editor.projectInfo.proofreadingUnavailable)}
      />
    );
  }

  let spelling = 0;
  let style = 0;
  for (const diagnostic of status.diagnostics) {
    if (diagnostic.source === "hunspell") spelling++;
    else style++;
  }

  return (
    <>
      <StatRow label={t(($) => $.editor.projectInfo.issues)} value={status.diagnosticCount} />
      {spellcheck ? (
        <StatRow indent label={t(($) => $.editor.projectInfo.spelling)} value={spelling} />
      ) : null}
      {grammar ? (
        <StatRow indent label={t(($) => $.editor.projectInfo.grammarAndStyle)} value={style} />
      ) : null}
      {status.truncated ? (
        <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground/70">
          {t(($) => $.editor.projectInfo.findingsTruncated)}
        </p>
      ) : null}
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
      trigger={<Info className="size-4" />}
      onOpenChange={load}
    >
      <ProjectInfoContent snapshot={snapshot} surface={surface} />
    </Popover>
  );
}

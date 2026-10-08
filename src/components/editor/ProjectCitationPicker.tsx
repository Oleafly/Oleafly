import {
  AtSign,
  BookOpenText,
  Plus,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  useDeferredValue,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverItem } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { currentProjectIntelligence } from "@/lib/project-intelligence/current";
import { citationCompletions } from "@/lib/project-intelligence/selectors";
import type { CitationCompletion } from "@/lib/project-intelligence/types";
import { useCitationStore } from "@/store/citation";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import {
  getWysiwygProjectIntelligenceCurrent,
  isWysiwygActive,
  subscribeWysiwygProjectIntelligence,
} from "@/components/editor/wysiwyg/controller";
import { projectIntelligenceFailureText } from "@/lib/project-intelligence/reason";
import { LoadingState } from "@/components/ui/empty";
import { insertTypstCitation } from "@/components/editor/typst-commands";
import { formattingProfileForPath } from "@/lib/document-engine";
import { ZoteroHintBanner } from "@/components/zotero/ZoteroHintBanner";
import { useZoteroSearch } from "@/components/zotero/use-zotero-search";
import { insertCitationKey } from "@/features/cite-insert";
import { insertZoteroCitation } from "@/features/zotero-actions";
import { existingKeyForHit, projectBibliography } from "@/features/zotero-cite";
import { hitByline, hitTitle, libraryLabel, truncated } from "@/lib/zotero/format";
import { useZoteroLibraryStore } from "@/store/zotero-library";

function CitationRow({
  completion,
  onInsert,
}: Readonly<{
  completion: CitationCompletion;
  onInsert: () => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <PopoverItem onClick={onInsert}>
      <span
        className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 py-0.5"
        style={{ contentVisibility: "auto", containIntrinsicSize: "36px" }}
      >
        <span className="truncate font-mono text-xs">
          {completion.key}
        </span>
        {completion.duplicate && (
          <span className="text-[9px] font-medium text-amber-700 dark:text-amber-300">
            {t(($) => $.editor.citations.duplicate, {
              index: completion.duplicateIndex + 1,
              total: completion.duplicateCount,
            })}
          </span>
        )}
        <span className="col-span-2 truncate text-[10px] text-muted-foreground">
          {t(($) => $.editor.citations.entryLocation, {
            detail: completion.detail,
            file: completion.location.file,
            line: completion.location.range.startLine,
          })}
        </span>
      </span>
    </PopoverItem>
  );
}

export function ProjectCitationPicker({
  variant,
}: Readonly<{
  variant: "bar" | "menu";
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const [query, setQuery] = useState("");

  return (
    <Popover
      ariaLabel={t(($) => $.editor.citations.trigger)}
      closeOnClick={false}
      className="w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
      triggerClassName={
        variant === "menu"
          ? "w-full justify-start gap-2 px-2 font-normal"
          : undefined
      }
      trigger={
        variant === "bar" ? (
          <AtSign className="size-4" />
        ) : (
          <>
            <AtSign className="size-4" />
            <span className="flex-1 text-left">{t(($) => $.editor.citations.trigger)}</span>
          </>
        )
      }
    >
      <CitationPickerContent query={query} onQueryChange={setQuery} />
    </Popover>
  );
}

function CitationPickerContent({
  query,
  onQueryChange,
}: Readonly<{
  query: string;
  onQueryChange: (query: string) => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const deferredQuery = useDeferredValue(query);
  const activePath = useFilesStore((state) => state.activePath);
  const activeContent = useFilesStore((state) =>
    state.activePath
      ? state.files[state.activePath]?.content ?? ""
      : "",
  );
  const formattingProfile = useFilesStore((state) =>
    formattingProfileForPath(state.engine, state.engineLoaded, state.activePath),
  );
  const intelligenceState = useIndexStore(
    (state) => state.intelligenceState,
  );
  const visualIntelligenceCurrent = useSyncExternalStore(
    subscribeWysiwygProjectIntelligence,
    getWysiwygProjectIntelligenceCurrent,
    () => false,
  );
  const visualAnalysisPending =
    isWysiwygActive() && !visualIntelligenceCurrent;

  // biome-ignore lint/correctness/useExhaustiveDependencies: activePath and analysis state are imperative store inputs to currentProjectIntelligence and must invalidate identical-text file switches/new snapshots.
  const current = useMemo(
    () =>
      visualAnalysisPending
        ? null
        : currentProjectIntelligence(activeContent),
    [
      activeContent,
      activePath,
      intelligenceState,
      visualAnalysisPending,
    ],
  );
  const completions = useMemo(
    () =>
      current
        ? citationCompletions(current.snapshot, deferredQuery, 80)
        : [],
    [current, deferredQuery],
  );

  const zoteroStatus = useZoteroLibraryStore((state) => state.status);
  const { hits: zoteroMatches } = useZoteroSearch(deferredQuery, 20);
  const zoteroHits = useMemo(() => {
    if (zoteroMatches.length === 0) return zoteroMatches;
    const project = projectBibliography();
    const listed = new Set(completions.map((completion) => completion.key));
    return zoteroMatches.filter(
      (hit) => !listed.has(hit.citationKey) && !project.keys.has(hit.citationKey) && !existingKeyForHit(hit, project),
    );
  }, [completions, zoteroMatches]);

  const insert = (completion: CitationCompletion) => {
    if (isWysiwygActive() && !getWysiwygProjectIntelligenceCurrent()) return;
    const files = useFilesStore.getState();
    const accepted = currentProjectIntelligence(
      files.activePath
        ? files.files[files.activePath]?.content
        : undefined,
    );
    const known = accepted?.snapshot.bibliography.entries.some(
      (candidate) => candidate.key === completion.key,
    );
    if (!known) return;
    if (formattingProfile === "typst") {
      void insertTypstCitation(completion.key, completion.location.file);
      return;
    }
    insertCitationKey(completion.key);
  };

  let status: "pending" | "error" | "ready";
  if (
    intelligenceState.status === "running" ||
    intelligenceState.status === "not_run" ||
    intelligenceState.stale
  ) {
    status = "pending";
  } else if (
    intelligenceState.status === "error" ||
    intelligenceState.status === "unavailable"
  ) {
    status = "error";
  } else {
    status = current ? "ready" : "pending";
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b px-2.5 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t(($) => $.editor.citations.filterPlaceholder)}
          aria-label={t(($) => $.editor.citations.filterLabel)}
          className="h-7 border-0 bg-transparent px-0 text-xs shadow-none"
        />
      </div>

      {intelligenceState.status === "partial" ||
      current?.snapshot.status === "partial" ? (
        <output className="block border-b border-amber-500/20 bg-amber-500/8 px-2.5 py-1.5 text-[10px] text-amber-800 dark:text-amber-200">
          {t(($) => $.editor.citations.partialCatalog)}
        </output>
      ) : null}

      <ZoteroHintBanner />

      <div className="max-h-72 overflow-y-auto p-1">
        {status === "pending" && (
          <LoadingState
            size="compact"
            className="px-2 py-4"
            label={t(($) => $.editor.citations.updatingList)}
          />
        )}
        {status === "error" && (
          <div
            role="alert"
            className="flex select-text items-start gap-2 px-2 py-4 text-xs text-destructive"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {projectIntelligenceFailureText(intelligenceState) ??
                t(($) => $.editor.citations.unavailable)}
            </span>
          </div>
        )}
        {status === "ready" && completions.length === 0 && zoteroHits.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            {deferredQuery
              ? t(($) => $.editor.citations.noMatches)
              : t(($) => $.editor.citations.noEntries)}
          </div>
        )}
        {status === "ready" &&
          completions.map((completion) => (
            <CitationRow
              key={completion.id}
              completion={completion}
              onInsert={() => insert(completion)}
            />
          ))}
        {zoteroHits.length > 0 && (
          <div data-testid="citation-picker-zotero">
            <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(($) => $.editor.citations.zoteroHeading)}
            </p>
            {zoteroHits.map((hit) => (
              <PopoverItem key={`${hit.library}:${hit.itemKey}`} onClick={() => insertZoteroCitation(hit)}>
                <span
                  className="grid min-w-0 flex-1 gap-y-0.5 py-0.5"
                  style={{ contentVisibility: "auto", containIntrinsicSize: "36px" }}
                >
                  <span className="truncate font-mono text-xs">{hit.citationKey}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {[hitByline(hit), truncated(hitTitle(hit)), libraryLabel(hit, zoteroStatus)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </PopoverItem>
            ))}
          </div>
        )}
      </div>

      <div className="border-t p-1">
        <PopoverItem
          onClick={() => useCitationStore.getState().setOpen(true)}
        >
          {completions.length > 0 ? (
            <Plus className="size-3.5 text-muted-foreground" />
          ) : (
            <BookOpenText className="size-3.5 text-muted-foreground" />
          )}
          <span>{t(($) => $.editor.citations.addNew)}</span>
        </PopoverItem>
      </div>
    </>
  );
}

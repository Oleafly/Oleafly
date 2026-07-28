import {
  AtSign,
  BookOpenText,
  Loader2,
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
import { Popover, PopoverItem } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { currentProjectIntelligence } from "@/lib/project-intelligence/current";
import { citationCompletions } from "@/lib/project-intelligence/selectors";
import type { CitationCompletion } from "@/lib/project-intelligence/types";
import { toast } from "@/lib/toast";
import { useCitationStore } from "@/store/citation";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import {
  getWysiwygProjectIntelligenceCurrent,
  isWysiwygActive,
  subscribeWysiwygProjectIntelligence,
} from "@/components/editor/wysiwyg/controller";

function citationSource(key: string, format: string): string {
  return format === "markdown" ? `[@${key}]` : `\\cite{${key}}`;
}

function CitationRow({
  completion,
  onInsert,
}: {
  completion: CitationCompletion;
  onInsert: () => void;
}) {
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
            duplicate {completion.duplicateIndex + 1}/
            {completion.duplicateCount}
          </span>
        )}
        <span className="col-span-2 truncate text-[10px] text-muted-foreground">
          {completion.detail} · {completion.location.file}:
          {completion.location.range.startLine}
        </span>
      </span>
    </PopoverItem>
  );
}

export function ProjectCitationPicker({
  variant,
}: {
  variant: "bar" | "menu";
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const activePath = useFilesStore((state) => state.activePath);
  const activeContent = useFilesStore((state) =>
    state.activePath
      ? state.files[state.activePath]?.content ?? ""
      : "",
  );
  const formattingProfile = useFilesStore(
    (state) => state.engine.capabilities.formatting_profile,
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

  const insert = (completion: CitationCompletion) => {
    if (
      isWysiwygActive() &&
      !getWysiwygProjectIntelligenceCurrent()
    ) {
      toast.info("Project citations are updating.");
      return;
    }
    const files = useFilesStore.getState();
    const accepted = currentProjectIntelligence(
      files.activePath
        ? files.files[files.activePath]?.content
        : undefined,
    );
    const entry = accepted?.snapshot.bibliography.entries.find(
      (candidate) => candidate.id === completion.id,
    );
    if (!accepted || accepted.snapshot !== current?.snapshot || !entry) {
      toast.info("Project citations changed. Reopen the picker to refresh.");
      return;
    }
    insertAtCursor(citationSource(entry.key, formattingProfile));
  };

  const status =
    intelligenceState.status === "running" ||
    intelligenceState.status === "not_run" ||
    intelligenceState.stale
      ? "pending"
      : intelligenceState.status === "error" ||
          intelligenceState.status === "unavailable"
        ? "error"
        : current
          ? "ready"
          : "pending";

  return (
    <Popover
      ariaLabel="Cite from project"
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
            <span className="flex-1 text-left">Cite from project</span>
          </>
        )
      }
    >
      <div className="flex items-center gap-2 border-b px-2.5 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Key, author, or title…"
          aria-label="Filter project citations"
          className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>

      {intelligenceState.status === "partial" ||
      current?.snapshot.status === "partial" ? (
        <div
          role="status"
          className="border-b border-amber-500/20 bg-amber-500/8 px-2.5 py-1.5 text-[10px] text-amber-800 dark:text-amber-200"
        >
          Partial catalog — malformed or unreadable bibliography files may be
          omitted.
        </div>
      ) : null}

      <div className="max-h-72 overflow-y-auto p-1">
        {status === "pending" && (
          <div
            role="status"
            className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground"
          >
            <Loader2 className="size-3.5 animate-spin" />
            Updating project citations…
          </div>
        )}
        {status === "error" && (
          <div
            role="alert"
            className="flex items-start gap-2 px-2 py-4 text-xs text-destructive"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {intelligenceState.failure?.message ??
                intelligenceState.reason ??
                "Citation analysis is unavailable."}
            </span>
          </div>
        )}
        {status === "ready" && completions.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            {deferredQuery
              ? "No matching project citations."
              : "No bibliography entries in this project yet."}
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
          <span>Find and add a new citation…</span>
        </PopoverItem>
      </div>
    </Popover>
  );
}

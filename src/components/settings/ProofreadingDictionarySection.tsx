import { useMemo, useState, type FormEvent } from "react";
import { BookMarked, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { ResetToDefaults } from "@/components/settings/ResetToDefaults";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  DICTIONARY_LIMITS,
  normalizeDictionaryWord,
  useDictionary,
} from "@/lib/dictionary";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

function AddWord({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (word: string) => void;
}) {
  const [value, setValue] = useState("");
  const normalized = normalizeDictionaryWord(value);
  const valid =
    normalized.length > 0 &&
    normalized.length <= DICTIONARY_LIMITS.wordCharacters &&
    !/[\p{Cc}\p{Cf}]/u.test(normalized);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onAdd(normalized);
    setValue("");
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        aria-label={label}
        autoComplete="off"
        maxLength={DICTIONARY_LIMITS.wordCharacters}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Add a word or term"
        spellCheck={false}
        value={value}
      />
      <Button
        type="submit"
        size="sm"
        disabled={!valid}
        aria-label="Add ignored word"
      >
        <Plus className="size-3.5" aria-hidden />
        Add
      </Button>
    </form>
  );
}

function WordChips({
  words,
  query,
  onRemove,
  emptyDescription,
  compactEmpty = false,
}: {
  words: string[];
  query: string;
  onRemove: (word: string) => void;
  emptyDescription: string;
  compactEmpty?: boolean;
}) {
  const visible = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase("en-US").trim();
    return [...words]
      .filter((word) =>
        word.toLocaleLowerCase("en-US").includes(normalizedQuery),
      )
      .sort((left, right) =>
        left.localeCompare(right, "en-US", { sensitivity: "base" }),
      );
  }, [query, words]);

  if (words.length === 0) {
    if (compactEmpty) {
      return <p className="text-xs text-muted-foreground">Nothing ignored yet.</p>;
    }
    return (
      <Empty className="gap-4 py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-10 rounded-lg">
            <BookMarked className="size-5" />
          </EmptyMedia>
          <EmptyTitle className="text-sm">Nothing ignored yet</EmptyTitle>
          <EmptyDescription className="text-xs">{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No ignored words match this search.
      </p>
    );
  }
  return (
    <ul
      className="m-0 flex max-h-52 list-none flex-wrap content-start gap-1.5 overflow-y-auto p-0"
      aria-label="Ignored words"
    >
      {visible.map((word) => (
        <li key={word}>
          <Badge
            variant="quiet"
            className="gap-1 py-1 pl-2.5 pr-1 font-normal"
          >
            <span className="font-mono">{word}</span>
            <button
              type="button"
              onClick={() => onRemove(word)}
              aria-label={`Stop ignoring ${word}`}
              title={`Stop ignoring “${word}”`}
              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="size-3" aria-hidden />
            </button>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

type ClearTarget =
  | { type: "global"; label: string }
  | { type: "project"; id: string; label: string }
  | { type: "suppressed"; id: string; label: string };

function TurnedOffFindings({
  projectId,
  projectName,
  suppressedCount,
  onClearSuppressed,
}: {
  projectId: string | null;
  projectName: string;
  suppressedCount: number;
  onClearSuppressed: () => void;
}) {
  const disabledRules = useSettingsStore((state) => state.harperDisabledRules);
  const enableHarperRule = useSettingsStore(
    (state) => state.enableHarperRule,
  );

  return (
    <section
      className="space-y-3 rounded-lg border bg-background p-3"
      aria-labelledby="proofreading-turned-off"
    >
      <div>
        <h4
          id="proofreading-turned-off"
          className="text-xs font-medium text-foreground"
        >
          Turned off rules and findings
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Rules you turned off from a proofreading card, and findings you
          dismissed one by one.
        </p>
      </div>
      {disabledRules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No grammar rules are turned off.
        </p>
      ) : (
        <ul
          className="m-0 flex max-h-40 list-none flex-wrap content-start gap-1.5 overflow-y-auto p-0"
          aria-label="Grammar rules turned off"
        >
          {disabledRules.map((rule) => (
            <li key={rule}>
              <Badge
                variant="quiet"
                className="gap-1 py-1 pl-2.5 pr-1 font-normal"
              >
                <span className="font-mono">{rule}</span>
                <button
                  type="button"
                  onClick={() => enableHarperRule(rule)}
                  aria-label={`Turn the ${rule} rule back on`}
                  title={`Turn the “${rule}” rule back on`}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <RotateCcw className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {projectId
              ? `Dismissed findings in ${projectName}`
              : "Dismissed findings"}
          </span>
          <Badge
            variant="primaryGhost"
            className="text-[10px] tabular-nums"
            data-testid="dictionary-suppressed-count"
          >
            {suppressedCount.toLocaleString()} /{" "}
            {DICTIONARY_LIMITS.suppressionsPerProject.toLocaleString()}
          </Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={suppressedCount === 0}
          onClick={onClearSuppressed}
        >
          <Trash2 className="size-3.5" aria-hidden />
          Show again
        </Button>
      </div>
    </section>
  );
}

export function ProofreadingDictionarySection() {
  const global = useDictionary((state) => state.global);
  const ignored = useDictionary((state) => state.ignored);
  const ignore = useDictionary((state) => state.ignore);
  const ignoreGlobal = useDictionary((state) => state.ignoreGlobal);
  const unignore = useDictionary((state) => state.unignore);
  const unignoreGlobal = useDictionary(
    (state) => state.unignoreGlobal,
  );
  const clear = useDictionary((state) => state.clear);
  const clearGlobal = useDictionary((state) => state.clearGlobal);
  const clearAll = useDictionary((state) => state.clearAll);
  const suppressed = useDictionary((state) => state.suppressed);
  const clearSuppressed = useDictionary((state) => state.clearSuppressed);
  const setHarperDisabledRules = useSettingsStore(
    (state) => state.setHarperDisabledRules,
  );
  const activeProjectId = useFilesStore((state) => state.projectId);
  const projects = useFilesStore((state) => state.projects);
  const [query, setQuery] = useState("");
  const [clearTarget, setClearTarget] = useState<ClearTarget | null>(
    null,
  );

  const projectEntries = useMemo(() => {
    const ids = new Set(
      Object.entries(ignored)
        .filter(([, words]) => words.length > 0)
        .map(([id]) => id),
    );
    if (activeProjectId) ids.add(activeProjectId);
    return [...ids]
      .map((id) => ({
        id,
        name: projects.find((project) => project.id === id)?.name ?? id,
        words: ignored[id] ?? [],
      }))
      .sort((left, right) =>
        left.name.localeCompare(right.name, "en-US", {
          sensitivity: "base",
        }),
      );
  }, [activeProjectId, ignored, projects]);

  const confirmClear = () => {
    if (clearTarget?.type === "global") clearGlobal();
    if (clearTarget?.type === "project") clear(clearTarget.id);
    if (clearTarget?.type === "suppressed") {
      clearSuppressed(clearTarget.id);
    }
    setClearTarget(null);
  };

  const activeProjectName =
    projects.find((project) => project.id === activeProjectId)?.name ??
    activeProjectId ??
    "";
  const suppressedCount = activeProjectId
    ? (suppressed[activeProjectId]?.length ?? 0)
    : 0;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Add words to your personal spellcheck dictionary. These words are
        stored in local settings and ignored across projects. Matching is
        Unicode-normalized and case-insensitive.
      </p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          aria-label="Search ignored words"
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search dictionary"
          type="search"
          value={query}
        />
      </div>
      <Tabs defaultValue="global" className="space-y-4">
        <TabsList>
          <TabsTrigger
            value="global"
            data-testid="dictionary-tab-global"
            className="gap-1.5"
          >
            Global
            <Badge
              variant="default"
              className="min-w-5 px-1.5 text-[10px] tabular-nums"
            >
              {global.length.toLocaleString()}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="projects"
            data-testid="dictionary-tab-projects"
            className="gap-1.5"
          >
            Projects
            <Badge
              variant="default"
              className="min-w-5 px-1.5 text-[10px] tabular-nums"
            >
              {projectEntries.length.toLocaleString()}
            </Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="global" className="space-y-3">
          <AddWord
            label="Add a globally ignored word"
            onAdd={ignoreGlobal}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                Applies to every project
              </span>
              <Badge
                variant="primaryGhost"
                className="text-[10px] tabular-nums"
              >
                {global.length.toLocaleString()} /{" "}
                {DICTIONARY_LIMITS.wordsPerScope.toLocaleString()}
              </Badge>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={global.length === 0}
              onClick={() =>
                setClearTarget({
                  type: "global",
                  label: "the global dictionary",
                })
              }
            >
              <Trash2 className="size-3.5" aria-hidden />
              Clear
            </Button>
          </div>
          <WordChips
            words={global}
            query={query}
            onRemove={unignoreGlobal}
            emptyDescription="Words you add here are skipped by the proofreader across every project."
          />
        </TabsContent>
        <TabsContent value="projects" className="space-y-4">
          {projectEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Open a project to add project-specific terms.
            </p>
          ) : (
            projectEntries.map(({ id, name, words }) => (
              <section
                key={id}
                className="space-y-3 rounded-lg border bg-background p-3"
                aria-labelledby={`dictionary-project-${id}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4
                      id={`dictionary-project-${id}`}
                      className="text-xs font-medium text-foreground"
                    >
                      {name}
                    </h4>
                    <Badge
                      variant="primaryGhost"
                      className="mt-1 text-[10px] tabular-nums"
                    >
                      {words.length.toLocaleString()} /{" "}
                      {DICTIONARY_LIMITS.wordsPerScope.toLocaleString()} terms
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={words.length === 0}
                    onClick={() =>
                      setClearTarget({ type: "project", id, label: name })
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Clear
                  </Button>
                </div>
                {id === activeProjectId ? (
                  <AddWord
                    label={`Add a word ignored in ${name}`}
                    onAdd={(word) => ignore(id, word)}
                  />
                ) : null}
                <WordChips
                  words={words}
                  query={query}
                  onRemove={(word) => unignore(id, word)}
                  emptyDescription="Words added for this project are skipped by the proofreader only here."
                  compactEmpty
                />
              </section>
            ))
          )}
        </TabsContent>
      </Tabs>
      <TurnedOffFindings
        projectId={activeProjectId}
        projectName={activeProjectName}
        suppressedCount={suppressedCount}
        onClearSuppressed={() =>
          activeProjectId &&
          setClearTarget({
            type: "suppressed",
            id: activeProjectId,
            label: `dismissed findings in ${activeProjectName}`,
          })
        }
      />
      <ResetToDefaults
        sectionName="Dictionary"
        onReset={() => {
          clearAll();
          setHarperDisabledRules([]);
        }}
        confirmationDescription="This permanently removes every ignored word, global and per-project, and turns every grammar rule back on. Proofreading will flag those words again."
      />
      <ConfirmationDialog
        open={clearTarget !== null}
        title={
          clearTarget?.type === "suppressed"
            ? "Show dismissed findings again?"
            : "Clear ignored words?"
        }
        description={`This removes all terms from ${clearTarget?.label ?? "this dictionary"}. They will be checked again immediately.`}
        confirmLabel={
          clearTarget?.type === "suppressed" ? "Show again" : "Clear words"
        }
        destructive
        onCancel={() => setClearTarget(null)}
        onConfirm={confirmClear}
      />
    </div>
  );
}

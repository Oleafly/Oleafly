import { useMemo, useState, type FormEvent } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
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
}: {
  words: string[];
  query: string;
  onRemove: (word: string) => void;
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
    return (
      <p className="text-xs text-muted-foreground">
        Nothing ignored yet.
      </p>
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
    <div
      className="flex max-h-52 flex-wrap content-start gap-1.5 overflow-y-auto"
      role="list"
      aria-label="Ignored words"
    >
      {visible.map((word) => (
        <span
          key={word}
          className="inline-flex items-center gap-1 rounded-md border bg-background py-1 pl-2 pr-1 text-xs"
        >
          <span className="font-mono">{word}</span>
          <button
            type="button"
            onClick={() => onRemove(word)}
            aria-label={`Stop ignoring ${word}`}
            title={`Stop ignoring “${word}”`}
            className="rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}

type ClearTarget =
  | { type: "global"; label: string }
  | { type: "project"; id: string; label: string };

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
    setClearTarget(null);
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Add names and technical terms that offline spelling and grammar
        should accept. Matching is Unicode-normalized and case-insensitive.
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
          <TabsTrigger value="global" data-testid="dictionary-tab-global">
            Global ({global.length})
          </TabsTrigger>
          <TabsTrigger
            value="projects"
            data-testid="dictionary-tab-projects"
          >
            Projects
          </TabsTrigger>
        </TabsList>
        <TabsContent value="global" className="space-y-3">
          <AddWord
            label="Add a globally ignored word"
            onAdd={ignoreGlobal}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Applies to every project · {global.length.toLocaleString()} /{" "}
              {DICTIONARY_LIMITS.wordsPerScope.toLocaleString()}
            </span>
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
                    <p className="text-[11px] text-muted-foreground">
                      {words.length.toLocaleString()} /{" "}
                      {DICTIONARY_LIMITS.wordsPerScope.toLocaleString()} terms
                    </p>
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
                />
              </section>
            ))
          )}
        </TabsContent>
      </Tabs>
      <ConfirmationDialog
        open={clearTarget !== null}
        title="Clear ignored words?"
        description={`This removes all terms from ${clearTarget?.label ?? "this dictionary"}. They will be checked again immediately.`}
        confirmLabel="Clear words"
        destructive
        onCancel={() => setClearTarget(null)}
        onConfirm={confirmClear}
      />
    </div>
  );
}

import { useMemo, useState, type FormEvent } from "react";
import { BookMarked, Plus, RotateCcw, Search, Trash2, X,
  Eye,
  CircleHelp,
} from "lucide-react";
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
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { ResetToDefaults } from "@/components/settings/ResetToDefaults";
import { Switch } from "@/components/ui/switch";
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
import {
  ACADEMIC_PROFILE_RULES,
} from "@/lib/proofreading/lint-profile";
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

function HelpTip({ label }: { readonly label: string }) {
  return (
    <Tooltip label={<span className="block max-w-72 text-left leading-relaxed">{label}</span>} side="bottom">
      <button
        type="button"
        aria-label={label}
        className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </button>
    </Tooltip>
  );
}

const NOTHING_TURNED_OFF = "You have not turned off any rules.";

function ProfileRules() {
  const enabledRules = useSettingsStore(
    (state) => state.harperEnabledRules,
  );
  const disabledRules = useSettingsStore(
    (state) => state.harperDisabledRules,
  );
  const setHarperEnabledRules = useSettingsStore(
    (state) => state.setHarperEnabledRules,
  );
  const enableHarperRule = useSettingsStore(
    (state) => state.enableHarperRule,
  );

  const overrides = useMemo(() => new Set(enabledRules), [enabledRules]);
  const turnedOff = useMemo(() => new Set(disabledRules), [disabledRules]);

  const toggle = (rule: string, on: boolean) => {
    if (!on) {
      setHarperEnabledRules(
        enabledRules.filter((candidate) => candidate !== rule),
      );
      return;
    }
    if (turnedOff.has(rule)) enableHarperRule(rule);
    if (!overrides.has(rule)) {
      setHarperEnabledRules([...enabledRules, rule]);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-center gap-1.5">
          <h5
            id="proofreading-profile-rules"
            className="text-xs font-medium text-foreground"
          >
            Rules the academic profile keeps off
          </h5>
          <HelpTip label="Harper is tuned for chat and email. These rules either push a style papers do not follow, such as spelling out kB and min, or trip over the placeholders that stand in for LaTeX markup, so Oleafly keeps them off. Each one shows what it would flag. Turn it on if you want those findings." />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Off by default because they get in the way of papers. Turn on any you want.
        </p>
      </div>
      <ul
        className="m-0 max-h-64 list-none space-y-1 overflow-y-auto p-0"
        aria-labelledby="proofreading-profile-rules"
      >
        {ACADEMIC_PROFILE_RULES.map(({ rule, reason, example }) => (
          <li
            key={rule}
            className="flex items-start justify-between gap-3 rounded-md px-1 py-1.5 hover:bg-accent/50"
          >
            <div className="min-w-0">
              <span className="font-mono text-xs text-foreground">
                {rule}
              </span>
              <p className="text-xs text-muted-foreground">{reason}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                Example: {example}
              </p>
            </div>
            <Switch
              aria-label={`Turn on ${rule}`}
              checked={overrides.has(rule) && !turnedOff.has(rule)}
              onCheckedChange={(value) => toggle(rule, value)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

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
        <div className="flex items-center gap-1.5">
          <h4
            id="proofreading-turned-off"
            className="text-xs font-medium text-foreground"
          >
            Grammar rules and dismissed findings
          </h4>
          <HelpTip label="Hover an underlined word or sentence in the editor and a small card shows what Harper found, with actions to fix it or ignore it. Rules you turned off from that card and findings you ignored in this project are listed here, so you can bring any of them back." />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Rules you turned off and findings you ignored in this project.
        </p>
      </div>
      {disabledRules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {NOTHING_TURNED_OFF}
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
      <ProfileRules />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {projectId
                ? `Dismissed findings in ${projectName}`
                : "Dismissed findings"}
            </span>
            <Badge
              variant="primaryGhost"
              className="text-[10px] tabular-nums"
              data-testid="dictionary-suppressed-count"
              title={`${suppressedCount.toLocaleString()} dismissed, out of ${DICTIONARY_LIMITS.suppressionsPerProject.toLocaleString()} the project can remember`}
            >
              {suppressedCount.toLocaleString()} /{" "}
              {DICTIONARY_LIMITS.suppressionsPerProject.toLocaleString()}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {suppressedCount === 0
              ? "Nothing is dismissed. When you choose Ignore in this project on a grammar finding, it is listed here."
              : `${suppressedCount.toLocaleString()} grammar ${suppressedCount === 1 ? "finding is" : "findings are"} hidden in this project because you chose Ignore in this project. Showing them again underlines them once more.`}
          </p>
        </div>
        {suppressedCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onClearSuppressed}
          >
            <Eye className="size-3.5" aria-hidden />
            Show them again
          </Button>
        )}
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
  const setHarperEnabledRules = useSettingsStore(
    (state) => state.setHarperEnabledRules,
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
          setHarperEnabledRules([]);
        }}
        confirmationDescription="This permanently removes every ignored word, global and per-project, and turns back on every grammar rule you turned off. The academic profile keeps its own rules off. Proofreading will flag those words again."
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

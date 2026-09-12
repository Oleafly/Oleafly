import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
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
import { formatNumber } from "@/lib/intl";
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
  const { t } = useTranslation(["common", "settings"]);
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
        placeholder={t(($) => $.settings.proofreading.addWord.placeholder)}
        spellCheck={false}
        value={value}
      />
      <Button
        type="submit"
        size="sm"
        disabled={!valid}
        aria-label={t(($) => $.settings.proofreading.addWord.submitAriaLabel)}
      >
        <Plus className="size-3.5" aria-hidden />
        {t(($) => $.common.actions.add)}
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
  const { t } = useTranslation(["common", "settings"]);
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
      return (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.proofreading.words.emptyCompact)}
        </p>
      );
    }
    return (
      <Empty className="gap-4 py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-10 rounded-lg">
            <BookMarked className="size-5" />
          </EmptyMedia>
          <EmptyTitle className="text-sm">
            {t(($) => $.settings.proofreading.words.emptyTitle)}
          </EmptyTitle>
          <EmptyDescription className="text-xs">{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t(($) => $.settings.proofreading.words.noMatches)}
      </p>
    );
  }
  return (
    <ul
      className="m-0 flex max-h-52 list-none flex-wrap content-start gap-1.5 overflow-y-auto p-0"
      aria-label={t(($) => $.settings.proofreading.words.listAriaLabel)}
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
              aria-label={t(($) => $.settings.proofreading.words.removeAriaLabel, { word })}
              title={t(($) => $.settings.proofreading.words.removeTitle, { word })}
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
  | { type: "global" }
  | { type: "project"; id: string; name: string }
  | { type: "suppressed"; id: string; name: string };

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

function ProfileRules() {
  const { t } = useTranslation(["common", "settings"]);
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
            {t(($) => $.settings.proofreading.profileRules.title)}
          </h5>
          <HelpTip label={t(($) => $.settings.proofreading.profileRules.help)} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(($) => $.settings.proofreading.profileRules.description)}
        </p>
      </div>
      <ul
        className="m-0 max-h-64 list-none space-y-1 overflow-y-auto p-0"
        aria-labelledby="proofreading-profile-rules"
      >
        {ACADEMIC_PROFILE_RULES.map(({ rule, example }) => (
          <li
            key={rule}
            className="flex items-start justify-between gap-3 rounded-md px-1 py-1.5 hover:bg-accent/50"
          >
            <div className="min-w-0">
              <span className="font-mono text-xs text-foreground">
                {rule}
              </span>
              <p className="text-xs text-muted-foreground">
                {t(($) => $.settings.proofreading.profileRules.reasons[rule])}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                {t(($) => $.settings.proofreading.profileRules.example, { example })}
              </p>
            </div>
            <Switch
              aria-label={t(($) => $.settings.proofreading.profileRules.toggleAriaLabel, { rule })}
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
  const { t } = useTranslation(["common", "settings"]);
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
            {t(($) => $.settings.proofreading.turnedOff.title)}
          </h4>
          <HelpTip label={t(($) => $.settings.proofreading.turnedOff.help)} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(($) => $.settings.proofreading.turnedOff.description)}
        </p>
      </div>
      {disabledRules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.proofreading.turnedOff.none)}
        </p>
      ) : (
        <ul
          className="m-0 flex max-h-40 list-none flex-wrap content-start gap-1.5 overflow-y-auto p-0"
          aria-label={t(($) => $.settings.proofreading.turnedOff.listAriaLabel)}
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
                  aria-label={t(($) => $.settings.proofreading.turnedOff.restoreAriaLabel, { rule })}
                  title={t(($) => $.settings.proofreading.turnedOff.restoreTitle, { rule })}
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
                ? t(($) => $.settings.proofreading.dismissed.titleInProject, {
                    project: projectName,
                  })
                : t(($) => $.settings.proofreading.dismissed.title)}
            </span>
            <Badge
              variant="primaryGhost"
              className="text-[10px] tabular-nums"
              data-testid="dictionary-suppressed-count"
              title={t(($) => $.settings.proofreading.dismissed.countTitle, {
                dismissed: formatNumber(suppressedCount),
                limit: formatNumber(DICTIONARY_LIMITS.suppressionsPerProject),
              })}
            >
              {formatNumber(suppressedCount)}
              {" / "}
              {formatNumber(DICTIONARY_LIMITS.suppressionsPerProject)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {suppressedCount === 0
              ? t(($) => $.settings.proofreading.dismissed.none)
              : t(($) => $.settings.proofreading.dismissed.hidden, {
                  count: suppressedCount,
                })}
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
            {t(($) => $.settings.proofreading.dismissed.showAgain)}
          </Button>
        )}
      </div>
    </section>
  );
}

export function ProofreadingDictionarySection() {
  const { t } = useTranslation(["common", "settings"]);
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

  const clearDescription =
    clearTarget?.type === "project"
      ? t(($) => $.settings.proofreading.clear.descriptionProject, {
          project: clearTarget.name,
        })
      : clearTarget?.type === "suppressed"
        ? t(($) => $.settings.proofreading.clear.descriptionSuppressed, {
            project: clearTarget.name,
          })
        : clearTarget?.type === "global"
          ? t(($) => $.settings.proofreading.clear.descriptionGlobal)
          : t(($) => $.settings.proofreading.clear.descriptionFallback);

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {t(($) => $.settings.proofreading.intro)}
      </p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          aria-label={t(($) => $.settings.proofreading.search.ariaLabel)}
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(($) => $.settings.proofreading.search.placeholder)}
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
            {t(($) => $.settings.proofreading.tabs.global)}
            <Badge
              variant="default"
              className="min-w-5 px-1.5 text-[10px] tabular-nums"
            >
              {formatNumber(global.length)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="projects"
            data-testid="dictionary-tab-projects"
            className="gap-1.5"
          >
            {t(($) => $.settings.proofreading.tabs.projects)}
            <Badge
              variant="default"
              className="min-w-5 px-1.5 text-[10px] tabular-nums"
            >
              {formatNumber(projectEntries.length)}
            </Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="global" className="space-y-3">
          <AddWord
            label={t(($) => $.settings.proofreading.addWord.globalAriaLabel)}
            onAdd={ignoreGlobal}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t(($) => $.settings.proofreading.global.scope)}
              </span>
              <Badge
                variant="primaryGhost"
                className="text-[10px] tabular-nums"
              >
                {formatNumber(global.length)}
                {" / "}
                {formatNumber(DICTIONARY_LIMITS.wordsPerScope)}
              </Badge>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={global.length === 0}
              onClick={() => setClearTarget({ type: "global" })}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {t(($) => $.common.actions.clear)}
            </Button>
          </div>
          <WordChips
            words={global}
            query={query}
            onRemove={unignoreGlobal}
            emptyDescription={t(($) => $.settings.proofreading.global.emptyDescription)}
          />
        </TabsContent>
        <TabsContent value="projects" className="space-y-4">
          {projectEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(($) => $.settings.proofreading.projects.empty)}
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
                      {t(($) => $.settings.proofreading.projects.terms, {
                        count: words.length,
                        used: formatNumber(words.length),
                        limit: formatNumber(DICTIONARY_LIMITS.wordsPerScope),
                      })}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={words.length === 0}
                    onClick={() =>
                      setClearTarget({ type: "project", id, name })
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {t(($) => $.common.actions.clear)}
                  </Button>
                </div>
                {id === activeProjectId ? (
                  <AddWord
                    label={t(($) => $.settings.proofreading.addWord.projectAriaLabel, {
                      project: name,
                    })}
                    onAdd={(word) => ignore(id, word)}
                  />
                ) : null}
                <WordChips
                  words={words}
                  query={query}
                  onRemove={(word) => unignore(id, word)}
                  emptyDescription={t(($) => $.settings.proofreading.projects.emptyDescription)}
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
            name: activeProjectName,
          })
        }
      />
      <ResetToDefaults
        sectionName={t(($) => $.settings.proofreading.reset.sectionName)}
        onReset={() => {
          clearAll();
          setHarperDisabledRules([]);
          setHarperEnabledRules([]);
        }}
        confirmationDescription={t(
          ($) => $.settings.proofreading.reset.confirmationDescription,
        )}
      />
      <ConfirmationDialog
        open={clearTarget !== null}
        title={
          clearTarget?.type === "suppressed"
            ? t(($) => $.settings.proofreading.clear.suppressedTitle)
            : t(($) => $.settings.proofreading.clear.title)
        }
        description={clearDescription}
        confirmLabel={
          clearTarget?.type === "suppressed"
            ? t(($) => $.settings.proofreading.clear.suppressedConfirm)
            : t(($) => $.settings.proofreading.clear.confirm)
        }
        destructive
        onCancel={() => setClearTarget(null)}
        onConfirm={confirmClear}
      />
    </div>
  );
}

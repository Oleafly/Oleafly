import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { SnippetLibrary, SnippetOverride, SnippetRecord } from "@oleafly/snippets";
import { ResetToDefaults } from "@/components/settings/ResetToDefaults";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { InlineAlert } from "@/components/ui/inline-alert";
import { draftFromRecord, newDraft } from "@/features/snippets/draft";
import { useSnippetSettingsRequest } from "@/features/snippets/open-settings";
import { snippetLanguageForPath } from "@/features/snippets/language";
import { collectionName, snippetMatches, snippetName, USER_COLLECTION, userCollections } from "@/features/snippets/records";
import { collectionOf, STATE_FILE, snippetsReady, useSnippetStore } from "@/features/snippets/store";
import { describeError } from "@/lib/app-error";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { sectionDiffersFromDefaults, useSettingsStore } from "@/store/settings";
import { AddSnippetsDialog } from "./AddSnippetsDialog";
import { collectionsOf, SnippetCollections } from "./SnippetCollections";
import { SnippetEditor, type SnippetEditorStart } from "./SnippetEditor";
import { type ShownProblem, SnippetProblems } from "./SnippetProblems";
import { type SnippetFilters, type SnippetRow, type SnippetStatus, SnippetTable } from "./SnippetTable";

const SWITCHES = [
  { key: "snippetsInList", setter: "setSnippetsInList", copy: "list" },
  { key: "snippetsTab", setter: "setSnippetsTab", copy: "tab" },
  { key: "snippetsAuto", setter: "setSnippetsAuto", copy: "auto" },
  { key: "snippetsHint", setter: "setSnippetsHint", copy: "hint" },
] as const;

function statusOf(record: SnippetRecord, overrides: readonly SnippetOverride[]): SnippetStatus {
  const override = overrides.find((candidate) => candidate.id === record.id && candidate.collection === record.collection);
  if (!override) return null;
  return override.disabled ? "off" : "modified";
}

function fileLabel(collection: string, userFiles: ReadonlySet<string>, names: (collection: string) => string): string {
  if (collection === collectionOf(STATE_FILE)) return STATE_FILE;
  return userFiles.has(collection) ? `${collection}.json` : names(collection);
}

function problemsOf(
  library: SnippetLibrary,
  disabledRegex: readonly string[],
  userFiles: ReadonlySet<string>,
  names: (collection: string) => string,
): ShownProblem[] {
  const listed = library.problems.map((problem, index) => ({
    key: `problem:${index}`,
    file: fileLabel(problem.collection, userFiles, names),
    line: problem.line,
    message: problem.message,
  }));
  const slow = disabledRegex.map((id) => {
    const record = library.all.find((candidate) => candidate.id === id);
    return {
      key: `slow:${id}`,
      file: null,
      line: 0,
      message: i18n.t(($) => $.settings.snippets.problems.slowRegex, { name: record ? snippetName(record) : id }),
    };
  });
  return [...listed, ...slow];
}

export function SnippetsSection() {
  const { t } = useTranslation(["common", "settings", "shell"]);
  const settings = useSettingsStore(
    useShallow((state) => ({
      snippetsInList: state.snippetsInList,
      snippetsTab: state.snippetsTab,
      snippetsAuto: state.snippetsAuto,
      snippetsHint: state.snippetsHint,
      setSnippetsInList: state.setSnippetsInList,
      setSnippetsTab: state.setSnippetsTab,
      setSnippetsAuto: state.setSnippetsAuto,
      setSnippetsHint: state.setSnippetsHint,
      resetSnippetsPreferences: state.resetSnippetsPreferences,
    })),
  );
  const changed = useSettingsStore((state) => sectionDiffersFromDefaults("snippets", state));
  const library = useSnippetStore((store) => store.library);
  const files = useSnippetStore((store) => store.files);
  const disk = useSnippetStore((store) => store.disk);
  const state = useSnippetStore((store) => store.state);
  const requested = useSnippetSettingsRequest((request) => request.recordId);
  const [filters, setFilters] = useState<SnippetFilters>({ query: "", language: null, expand: null });
  const [collection, setCollection] = useState<string | null>(null);
  const [editing, setEditing] = useState<SnippetEditorStart | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    snippetsReady().catch((reason: unknown) => setError(describeError(reason)));
  }, []);

  useEffect(() => {
    if (requested === null) return;
    const record = library.byId(requested) ?? library.all.find((candidate) => candidate.id === requested);
    if (!record) return;
    useSnippetSettingsRequest.setState({ recordId: null });
    setEditing({ base: record, draft: draftFromRecord(record) });
  }, [requested, library]);

  const mine = useMemo(() => userCollections(disk), [disk]);
  const userFiles = useMemo(() => new Set(mine), [mine]);
  const disabled = useMemo(() => new Set(state.disabledCollections), [state.disabledCollections]);
  const collections = useMemo(
    () =>
      collectionsOf(
        library.all,
        (id) => collectionName(id, files),
        disabled,
        mine.map((id) => ({ id, layer: "user" as const })),
      ),
    [library, files, disabled, mine],
  );
  const rows = useMemo<SnippetRow[]>(
    () =>
      library.all
        .filter(
          (record) =>
            (collection === null || record.collection === collection) &&
            (filters.language === null || record.languages === "any" || record.languages.includes(filters.language)) &&
            (filters.expand === null || record.expand === filters.expand) &&
            snippetMatches(record, filters.query),
        )
        .map((record) => ({ record, status: statusOf(record, state.overrides) })),
    [library, collection, filters, state.overrides],
  );
  const switchesOn = SWITCHES.some(({ key }) => settings[key]);
  const problems = useMemo(
    () => problemsOf(library, state.disabledRegex, userFiles, (id) => collectionName(id, files)),
    [library, state.disabledRegex, userFiles, files],
  );

  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((reason: unknown) => setError(describeError(reason)));
  };

  const restore = (record: SnippetRecord) =>
    run(() => useSnippetStore.getState().setOverride({ id: record.id, collection: record.collection, clear: true }));

  if (editing) {
    return <SnippetEditor key={editing.base?.id ?? "new"} start={editing} onClose={() => setEditing(null)} />;
  }

  return (
    <div className="space-y-4 text-sm" data-testid="snippets-settings">
      <div className="grid gap-2 md:grid-cols-2">
        {SWITCHES.map(({ key, setter, copy }) => (
          <SettingsToggleRow
            key={key}
            testId={`snippets-switch-${copy}`}
            label={t(($) => $.settings.snippets.switches[copy].label)}
            description={t(($) => $.settings.snippets.switches[copy].description)}
            checked={settings[key]}
            onChange={settings[setter]}
          />
        ))}
      </div>

      <section
        aria-label={t(($) => $.settings.snippets.library.title)}
        className="space-y-3 overflow-hidden rounded-xl border bg-card/60 p-3"
      >
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="md:w-60 md:shrink-0">
            <SnippetCollections
              collections={collections}
              total={library.all.length}
              selected={collection}
              onSelect={setCollection}
              onToggle={(id, enabled) => run(() => useSnippetStore.getState().setCollectionEnabled(id, enabled))}
              onAdd={() => setAdding(true)}
            />
          </div>
          <SnippetTable
            rows={rows}
            total={library.all.length}
            filters={filters}
            onFiltersChange={setFilters}
            onEdit={(record) => setEditing({ base: record, draft: draftFromRecord(record) })}
            onRestore={restore}
            onNew={() => {
              const language = snippetLanguageForPath(useFilesStore.getState().activePath);
              const target = collection !== null && userFiles.has(collection) ? collection : USER_COLLECTION;
              setEditing({ base: null, draft: newDraft(language, target) });
            }}
          />
        </div>
        {switchesOn ? <SnippetProblems problems={problems} /> : null}
        {error ? <InlineAlert>{error}</InlineAlert> : null}
      </section>

      <AddSnippetsDialog open={adding} onOpenChange={setAdding} />
      <ResetToDefaults
        sectionName={t(($) => $.shell.settings.nav.snippets)}
        onReset={settings.resetSnippetsPreferences}
        changed={changed}
      />
    </div>
  );
}

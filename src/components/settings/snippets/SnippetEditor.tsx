import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EditorView } from "@codemirror/view";
import { ChevronDown, Copy, Power, Save, Trash2 } from "lucide-react";
import {
  escapeBodyText,
  type Expand,
  type Place,
  type ProjectFieldKind,
  PROJECT_FIELD_KINDS,
  SNIPPET_LANGUAGES,
  type SnippetLanguage,
  type SnippetRecord,
} from "@oleafly/snippets";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input, LITERAL_INPUT } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolSegmentedControl } from "@/components/tools/ToolWorkspace";
import { SettingsNote } from "@/components/settings/SettingsNote";
import {
  type BodyKey,
  bodyKeys,
  draftRecord,
  nextFieldIndex,
  type SnippetClash,
  type SnippetDraft,
  snippetClashes,
  uniqueRecordId,
} from "@/features/snippets/draft";
import { collectionName, isMathPlace, languageLabel, snippetName, userCollections } from "@/features/snippets/records";
import { useSnippetStore } from "@/features/snippets/store";
import { describeError } from "@/lib/app-error";
import { SnippetBodyEditor } from "./SnippetBodyEditor";
import { SnippetTryIt } from "./SnippetTryIt";

const EXPANDS: readonly Expand[] = ["list", "tab", "auto"];
const WHERE = ["any", "text", "math", "code"] as const;
const MATH_KINDS = ["math", "inline-math", "display-math"] as const;
const VARIABLES = ["SELECTION", "CLIPBOARD", "DATE", "TM_FILENAME", "PROJECT_NAME"] as const;
const VARIABLE_FORMATS: Partial<Record<(typeof VARIABLES)[number], string>> = { DATE: "D MMMM YYYY" };

function variableText(name: (typeof VARIABLES)[number]): string {
  const format = VARIABLE_FORMATS[name];
  return format ? `\${${name}:${format}}` : `\${${name}}`;
}

const LANGUAGE_CHOICES: readonly (SnippetLanguage | "any")[] = [...SNIPPET_LANGUAGES, "any"];
const CLASH_NAMES = 3;

type Where = (typeof WHERE)[number];

export interface SnippetEditorStart {
  base: SnippetRecord | null;
  draft: SnippetDraft;
}

function whereOf(place: Place): Where {
  return isMathPlace(place) ? "math" : (place as Where);
}

function withLanguages(draft: SnippetDraft, languages: SnippetDraft["languages"]): SnippetDraft {
  const oldKeys = bodyKeys(draft.languages);
  const carried = draft.bodies[oldKeys[0]] ?? "";
  const bodies: SnippetDraft["bodies"] = {};
  for (const key of bodyKeys(languages)) bodies[key] = draft.bodies[key] ?? carried;
  return { ...draft, languages, bodies };
}

function toggledLanguages(current: SnippetDraft["languages"], choice: SnippetLanguage | "any"): SnippetDraft["languages"] {
  if (choice === "any") return "any";
  if (current === "any") return [choice];
  if (!current.includes(choice)) return SNIPPET_LANGUAGES.filter((language) => language === choice || current.includes(language));
  const rest = current.filter((language) => language !== choice);
  return rest.length > 0 ? rest : "any";
}

function Field({ id, label, children }: Readonly<{ id?: string; label: string; children: ReactNode }>) {
  return (
    <div className="space-y-1.5">
      {id ? (
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
      ) : (
        <div className="text-xs font-medium">{label}</div>
      )}
      {children}
    </div>
  );
}

function Help({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function SnippetEditor({ start, onClose }: Readonly<{ start: SnippetEditorStart; onClose: () => void }>) {
  const { t } = useTranslation(["common", "settings", "shell"]);
  const id = useId();
  const library = useSnippetStore((store) => store.library);
  const files = useSnippetStore((store) => store.files);
  const disk = useSnippetStore((store) => store.disk);
  const [base, setBase] = useState(start.base);
  const [draft, setDraft] = useState(start.draft);
  const [tab, setTab] = useState<BodyKey>(bodyKeys(start.draft.languages)[0]);
  const [showSyntax, setShowSyntax] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const view = useRef<EditorView | null>(null);
  const own = base === null || base.layer === "user";
  const keys = bodyKeys(draft.languages);
  const activeTab = keys.includes(tab) ? tab : keys[0];
  const recordId = base?.id ?? uniqueRecordId(draft.name, (candidate) => library.all.some((record) => record.id === candidate));
  const result = useMemo(() => draftRecord(draft, base, recordId), [draft, base, recordId]);
  const clashes = useMemo(() => snippetClashes(draft, library), [draft, library]);
  const collections = useMemo(() => userCollections(disk), [disk]);
  const name = draft.name.trim() || t(($) => $.settings.snippets.editor.newTitle);
  const trigger = draft.trigger.trim();
  const update = (patch: Partial<SnippetDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const setBody = (key: BodyKey, text: string) =>
    setDraft((current) => ({ ...current, bodies: { ...current.bodies, [key]: text } }));

  const insert = (make: (index: number, selected: string) => string) => {
    const current = view.current;
    if (!current) return;
    const range = current.state.selection.main;
    const selected = current.state.sliceDoc(range.from, range.to);
    current.dispatch(current.state.replaceSelection(make(nextFieldIndex(current.state.doc.toString()), selected)));
    current.focus();
  };

  const save = async () => {
    setAttempted(true);
    setSaveError(null);
    if (!result.record) return;
    setSaving(true);
    try {
      const store = useSnippetStore.getState();
      await store.saveRecord(draft.collection, result.record);
      if (base && own && base.collection !== draft.collection) await store.deleteRecord(base.collection, base.id);
      onClose();
    } catch (error) {
      setSaveError(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (!base) return;
    try {
      await useSnippetStore.getState().deleteRecord(base.collection, base.id);
      onClose();
    } catch (error) {
      setSaveError(describeError(error));
    }
  };

  const duplicate = () => {
    setBase(null);
    setAttempted(false);
    setDraft((current) => ({
      ...current,
      id: null,
      collection: collections[0],
      name: t(($) => $.settings.snippets.editor.copyName, { name: current.name }),
    }));
  };

  const clashText = (clash: SnippetClash) => {
    const shown = clash.records.slice(0, CLASH_NAMES).map((record) =>
      t(($) => $.settings.snippets.editor.clashItem, {
        trigger: clash.kind === "duplicate" ? snippetName(record) : (record.trigger ?? ""),
        collection: collectionName(record.collection, files),
      }),
    );
    const list = clash.records.length > CLASH_NAMES ? [...shown, "…"].join(", ") : shown.join(", ");
    return clash.kind === "duplicate"
      ? t(($) => $.settings.snippets.editor.sameTrigger, { list, trigger })
      : t(($) => $.settings.snippets.editor.sharedStart, { list, trigger });
  };

  return (
    <div className="space-y-4 text-sm" data-testid="snippet-editor">
      <div className="flex flex-wrap items-center gap-2">
        <Breadcrumb aria-label={t(($) => $.shell.settings.nav.snippets)} className="min-w-0 flex-1">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button type="button" onClick={onClose}>
                  {t(($) => $.shell.settings.nav.snippets)}
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage>{name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {base ? (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={duplicate}>
              <Copy aria-hidden />
              {t(($) => $.settings.snippets.editor.duplicate)}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => (own ? setConfirmDelete(true) : void remove())}>
              {own ? <Trash2 aria-hidden /> : <Power aria-hidden />}
              {own ? t(($) => $.settings.snippets.editor.delete) : t(($) => $.settings.snippets.editor.turnOff)}
            </Button>
          </>
        ) : null}
        <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
          <Save aria-hidden />
          {t(($) => $.settings.snippets.editor.save)}
        </Button>
      </div>

      <div className="grid gap-4 rounded-xl border bg-card/60 p-4 md:grid-cols-2">
        <Field id={`${id}-name`} label={t(($) => $.settings.snippets.editor.name)}>
          <Input
            id={`${id}-name`}
            value={draft.name}
            placeholder={t(($) => $.settings.snippets.editor.namePlaceholder)}
            onChange={(event) => update({ name: event.target.value })}
          />
        </Field>
        <div className="space-y-1.5">
          <Field id={`${id}-trigger`} label={t(($) => $.settings.snippets.editor.trigger)}>
            <Input
              id={`${id}-trigger`}
              {...LITERAL_INPUT}
              className="font-mono"
              value={draft.trigger}
              placeholder={t(($) => $.settings.snippets.editor.triggerPlaceholder)}
              onChange={(event) => update({ trigger: event.target.value })}
            />
          </Field>
          <label htmlFor={`${id}-regex`} className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox id={`${id}-regex`} checked={draft.regex} onCheckedChange={(checked) => update({ regex: checked === true })} />
            {t(($) => $.settings.snippets.editor.regex)}
          </label>
        </div>

        <Field label={t(($) => $.settings.snippets.editor.expands)}>
          <ToolSegmentedControl
            label={t(($) => $.settings.snippets.editor.expands)}
            value={draft.expand}
            options={EXPANDS.map((value) => ({ value, label: t(($) => $.settings.snippets.editor.expandOptions[value]) }))}
            onChange={(expand) => update({ expand })}
          />
          <Help>{t(($) => $.settings.snippets.editor.expandHelp[draft.expand], { trigger: trigger || t(($) => $.settings.snippets.editor.triggerPlaceholder) })}</Help>
        </Field>
        <Field label={t(($) => $.settings.snippets.editor.languages)}>
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGE_CHOICES.map((language) => (
              <Chip
                key={language}
                pressed={draft.languages === "any" ? language === "any" : language !== "any" && draft.languages.includes(language)}
                onClick={() => {
                  setDraft((current) => withLanguages(current, toggledLanguages(current.languages, language)));
                }}
              >
                {languageLabel(language)}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label={t(($) => $.settings.snippets.editor.where)}>
          <div className="flex flex-wrap items-center gap-2">
            <ToolSegmentedControl
              label={t(($) => $.settings.snippets.editor.where)}
              value={whereOf(draft.place)}
              options={WHERE.map((value) => ({ value, label: t(($) => $.settings.snippets.editor.whereOptions[value]) }))}
              onChange={(where) => update({ place: where })}
            />
            {isMathPlace(draft.place) ? (
              <ToolSegmentedControl
                label={t(($) => $.settings.snippets.editor.mathKind)}
                value={draft.place as (typeof MATH_KINDS)[number]}
                options={MATH_KINDS.map((value) => ({ value, label: t(($) => $.settings.snippets.editor.mathKinds[value]) }))}
                onChange={(place) => update({ place })}
              />
            ) : null}
          </div>
          <Help>{t(($) => $.settings.snippets.editor.whereHelp[whereOf(draft.place)])}</Help>
        </Field>
        <Field label={t(($) => $.settings.snippets.editor.firesOnly)}>
          <label htmlFor={`${id}-word`} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox id={`${id}-word`} checked={draft.wholeWord} onCheckedChange={(checked) => update({ wholeWord: checked === true })} />
            {t(($) => $.settings.snippets.editor.wholeWord)}
          </label>
          <label htmlFor={`${id}-line`} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox id={`${id}-line`} checked={draft.lineStart} onCheckedChange={(checked) => update({ lineStart: checked === true })} />
            {t(($) => $.settings.snippets.editor.lineStart)}
          </label>
        </Field>

        <Field label={t(($) => $.settings.snippets.editor.collection)}>
          {own ? (
            <Select value={draft.collection} onValueChange={(collection) => update({ collection })}>
              <SelectTrigger className="w-56" aria-label={t(($) => $.settings.snippets.editor.collection)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[100]">
                {collections.map((collection) => (
                  <SelectItem key={collection} value={collection}>
                    {collectionName(collection, files)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Help>
              {t(($) => $.settings.snippets.editor.keptSeparately, { collection: collectionName(draft.collection, files) })}
            </Help>
          )}
        </Field>
      </div>

      <div className="space-y-2 rounded-xl border bg-card/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={activeTab} onValueChange={(value) => setTab(value as BodyKey)}>
            <TabsList size="sm" aria-label={t(($) => $.settings.snippets.editor.body)}>
              {keys.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {key === "default" ? t(($) => $.settings.snippets.editor.anyLanguage) : languageLabel(key)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() =>
                insert((index, selected) => (selected ? `\${${index}:${escapeBodyText(selected, "placeholder")}}` : `\${${index}}`))
              }
            >
              {t(($) => $.settings.snippets.editor.addField)}
            </Button>
            <Button type="button" variant="outline" size="xs" onClick={() => insert((index) => `\${${index}|${t(($) => $.settings.snippets.editor.choiceText)}|}`)}>
              {t(($) => $.settings.snippets.editor.addChoice)}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="xs">
                  {t(($) => $.settings.snippets.editor.variable)}
                  <ChevronDown aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[100]">
                {VARIABLES.map((variable) => (
                  <DropdownMenuItem key={variable} onSelect={() => insert(() => variableText(variable))}>
                    {t(($) => $.settings.snippets.editor.variables[variable])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="xs">
                  {t(($) => $.settings.snippets.editor.projectField)}
                  <ChevronDown aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[100]">
                {PROJECT_FIELD_KINDS.map((kind: ProjectFieldKind) => (
                  <DropdownMenuItem key={kind} onSelect={() => insert((index) => `\${${index}@${kind}}`)}>
                    {t(($) => $.settings.snippets.editor.projectFields[kind])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <SnippetBodyEditor
          value={draft.bodies[activeTab] ?? ""}
          onChange={(text) => setBody(activeTab, text)}
          language={activeTab}
          showSyntax={showSyntax}
          ariaLabel={t(($) => $.settings.snippets.editor.body)}
          onView={(next) => {
            view.current = next;
          }}
          testId="snippet-body"
        />
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          {showSyntax ? null : <span>{t(($) => $.settings.snippets.editor.chipsNote)}</span>}
          <label htmlFor={`${id}-syntax`} className="flex cursor-pointer items-center gap-2">
            {t(($) => $.settings.snippets.editor.showSyntax)}
            <Switch id={`${id}-syntax`} checked={showSyntax} onCheckedChange={setShowSyntax} />
          </label>
        </div>
      </div>

      {result.record ? (
        <SnippetTryIt
          record={result.record}
          languages={draft.languages === "any" ? ["latex", "typst", "markdown"] : draft.languages}
        />
      ) : null}

      {clashes.map((clash) => (
        <SettingsNote key={clash.kind} testId={`snippet-clash-${clash.kind}`}>
          {clashText(clash)}
        </SettingsNote>
      ))}
      {result.warnings.map((warning) => (
        <SettingsNote key={warning}>{warning}</SettingsNote>
      ))}
      {attempted && result.missing === "name" ? <InlineAlert>{t(($) => $.settings.snippets.editor.missingName)}</InlineAlert> : null}
      {attempted && result.missing === "body" ? <InlineAlert>{t(($) => $.settings.snippets.editor.missingBody)}</InlineAlert> : null}
      {attempted
        ? result.errors.map((error) => <InlineAlert key={error}>{error}</InlineAlert>)
        : null}
      {saveError ? <InlineAlert>{saveError}</InlineAlert> : null}

      <ConfirmationDialog
        open={confirmDelete}
        title={t(($) => $.settings.snippets.editor.deleteDialog.title, { name })}
        description={t(($) => $.settings.snippets.editor.deleteDialog.description, {
          collection: collectionName(draft.collection, files),
        })}
        confirmLabel={t(($) => $.settings.snippets.editor.deleteDialog.action)}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

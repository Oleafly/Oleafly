import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { bodyFromSelection, type Expand, type FieldSuggestion, suggestFields } from "@oleafly/snippets";
import { SnippetBodyEditor } from "@/components/settings/snippets/SnippetBodyEditor";
import { ToolSegmentedControl } from "@/components/tools/ToolWorkspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input, LITERAL_INPUT } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeading } from "@/components/ui/section-heading";
import { describeError } from "@/lib/app-error";
import { toast } from "@/lib/toast";
import { draftRecord, newDraft, uniqueRecordId } from "./draft";
import { collectionName, expandLabel, languageLabel, placeLabel, userCollections } from "./records";
import { type SnippetSelection, useSaveSnippetDialog } from "./save-dialog";
import { useSnippetStore } from "./store";

const EXPANDS: readonly Expand[] = ["list", "tab", "auto"];

function SaveSnippetForm({ selection, onClose }: Readonly<{ selection: SnippetSelection; onClose: () => void }>) {
  const { t } = useTranslation(["common", "shell"]);
  const id = useId();
  const files = useSnippetStore((store) => store.files);
  const disk = useSnippetStore((store) => store.disk);
  const collections = useMemo(() => userCollections(disk), [disk]);
  const suggestions = useMemo<FieldSuggestion[]>(
    () => (selection.language ? suggestFields(selection.text, selection.language) : []),
    [selection],
  );
  const [chosen, setChosen] = useState<ReadonlySet<number>>(
    () => new Set(suggestions.flatMap((suggestion, index) => (suggestion.selected ? [index] : []))),
  );
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [expand, setExpand] = useState<Expand>("tab");
  const [collection, setCollection] = useState(collections[0]);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const body = useMemo(
    () => bodyFromSelection(selection.text, suggestions.filter((_, index) => chosen.has(index))),
    [selection.text, suggestions, chosen],
  );
  const bodyKey = selection.language ?? "default";

  const toggle = (index: number, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });

  const save = async () => {
    setAttempted(true);
    setError(null);
    if (!name.trim()) return;
    const draft = {
      ...newDraft(selection.language, collection),
      name,
      trigger,
      expand,
      place: selection.place,
      bodies: { [bodyKey]: body },
    };
    const library = useSnippetStore.getState().library;
    const result = draftRecord(draft, null, uniqueRecordId(name, (candidate) => library.all.some((record) => record.id === candidate)));
    if (!result.record) {
      setError(result.errors.join(" "));
      return;
    }
    setSaving(true);
    try {
      await useSnippetStore.getState().saveRecord(collection, result.record);
      toast.success(t(($) => $.shell.snippets.save.saved, { name: name.trim() }));
      onClose();
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-name`} className="text-xs font-medium">
            {t(($) => $.shell.snippets.save.name)}
          </label>
          <Input
            id={`${id}-name`}
            value={name}
            placeholder={t(($) => $.shell.snippets.save.namePlaceholder)}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-trigger`} className="text-xs font-medium">
            {t(($) => $.shell.snippets.save.trigger)}
          </label>
          <Input
            id={`${id}-trigger`}
            {...LITERAL_INPUT}
            className="font-mono"
            value={trigger}
            placeholder={t(($) => $.shell.snippets.save.triggerPlaceholder)}
            onChange={(event) => setTrigger(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{t(($) => $.shell.snippets.save.expands)}</span>
        <ToolSegmentedControl
          label={t(($) => $.shell.snippets.save.expands)}
          value={expand}
          options={EXPANDS.map((value) => ({ value, label: expandLabel(value) }))}
          onChange={setExpand}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="primaryGhost" size="sm">
          {languageLabel(selection.language ?? "any")}
        </Badge>
        <Badge variant="primaryGhost" size="sm">
          {placeLabel(selection.place)}
        </Badge>
        <span>{t(($) => $.shell.snippets.save.found)}</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <SectionHeading as="h4">{t(($) => $.shell.snippets.save.fields)}</SectionHeading>
          {suggestions.length > 0 ? (
            <Badge variant="muted" size="sm">
              {t(($) => $.shell.snippets.save.fieldsFound, { count: suggestions.length })}
            </Badge>
          ) : null}
        </div>
        {suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.shell.snippets.save.noFields)}</p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-auto">
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.from}:${suggestion.kind}`}>
                <label htmlFor={`${id}-field-${index}`} className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    id={`${id}-field-${index}`}
                    checked={chosen.has(index)}
                    onCheckedChange={(checked) => toggle(index, checked === true)}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono">{suggestion.text}</span>
                  {suggestion.linkedTo !== undefined ? (
                    <span className="text-muted-foreground">{t(($) => $.shell.snippets.save.followsCaption)}</span>
                  ) : null}
                  <Badge variant="muted" size="sm">
                    {t(($) => $.shell.snippets.save.kinds[suggestion.kind])}
                  </Badge>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1.5">
        <SectionHeading as="h4">{t(($) => $.shell.snippets.save.preview)}</SectionHeading>
        <SnippetBodyEditor
          value={body}
          language={bodyKey}
          showSyntax={false}
          readOnly
          ariaLabel={t(($) => $.shell.snippets.save.preview)}
          testId="save-snippet-preview"
        />
      </div>
      {attempted && !name.trim() ? <InlineAlert>{t(($) => $.shell.snippets.save.missingName)}</InlineAlert> : null}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <DialogFooter className="items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{t(($) => $.shell.snippets.save.saveTo)}</span>
          <Select value={collection} onValueChange={setCollection}>
            <SelectTrigger className="h-8 w-44" aria-label={t(($) => $.shell.snippets.save.saveTo)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {collections.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {collectionName(candidate, files)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t(($) => $.common.actions.cancel)}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {t(($) => $.shell.snippets.save.submit)}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

export function SaveSnippetDialog() {
  const { t } = useTranslation(["shell"]);
  const selection = useSaveSnippetDialog((state) => state.selection);
  const close = useSaveSnippetDialog((state) => state.close);
  return (
    <Dialog open={selection !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t(($) => $.shell.snippets.save.title)}</DialogTitle>
        </DialogHeader>
        {selection ? <SaveSnippetForm key={selection.text} selection={selection} onClose={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}

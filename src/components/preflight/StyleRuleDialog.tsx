import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SpellCheck } from "lucide-react";
import { customRuleMatches, nextCustomRuleId, proseView } from "@oleafly/preflight/writing";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveWritingSettings } from "@/features/writing-actions";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useStyleRuleDialogStore } from "@/store/style-rule-dialog";

const WRITING_SOURCE = /\.(?:tex|ltx)$/i;

function projectWritingTexts(): string[] {
  const texts: Record<string, string> = { ...useIndexStore.getState().texts };
  for (const [path, file] of Object.entries(useFilesStore.getState().files)) {
    if (file?.content !== undefined) texts[path] = file.content;
  }
  return Object.entries(texts)
    .filter(([path]) => WRITING_SOURCE.test(path))
    .map(([, content]) => content);
}

export function countStyleRuleMatches(
  texts: readonly string[],
  rule: { find: string; wholeWord: boolean; caseSensitive: boolean },
): number {
  if (rule.find.trim().length === 0) return 0;
  return texts.reduce((sum, text) => sum + customRuleMatches(proseView(text), rule).length, 0);
}

export function StyleRuleDialog() {
  const { t } = useTranslation(["common", "preflight"]);
  const open = useStyleRuleDialogStore((s) => s.open);
  const initialFind = useStyleRuleDialogStore((s) => s.find);
  const setOpen = useStyleRuleDialogStore((s) => s.setOpen);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [note, setNote] = useState("");
  const [wholeWord, setWholeWord] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFind(initialFind);
    setReplace("");
    setNote("");
    setWholeWord(true);
    setCaseSensitive(true);
  }, [open, initialFind]);

  const texts = useMemo(() => (open ? projectWritingTexts() : []), [open]);
  const deferredFind = useDeferredValue(find);
  const matches = useMemo(
    () => countStyleRuleMatches(texts, { find: deferredFind, wholeWord, caseSensitive }),
    [texts, deferredFind, wholeWord, caseSensitive],
  );
  const valid = find.trim().length > 0 && find.length <= 200 && replace.length <= 200 && note.length <= 200;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const rule = {
      find,
      replace: replace.length > 0 ? replace : null,
      wholeWord,
      caseSensitive,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const saved = await saveWritingSettings((current) => ({
      ...current,
      rules: [...current.rules, { ...rule, id: nextCustomRuleId(current) }],
    }));
    setSaving(false);
    if (!saved) return;
    toast.success(t(($) => $.preflight.styleRule.saved));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="style-rule-dialog" className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
              <SpellCheck aria-hidden className="size-4" />
            </div>
            <DialogTitle className="text-sm">{t(($) => $.preflight.styleRule.title)}</DialogTitle>
          </div>
          <DialogDescription className="text-xs leading-relaxed">{t(($) => $.preflight.styleRule.description)}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-1.5">
            <label htmlFor="style-rule-find" className="text-xs text-muted-foreground">{t(($) => $.preflight.styleRule.find)}</label>
            <Input id="style-rule-find" data-testid="style-rule-find" value={find} maxLength={200} onChange={(event) => setFind(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="style-rule-replace" className="text-xs text-muted-foreground">{t(($) => $.preflight.styleRule.replace)}</label>
            <Input id="style-rule-replace" data-testid="style-rule-replace" value={replace} maxLength={200} onChange={(event) => setReplace(event.target.value)} />
            <p className="text-[0.6875rem] text-muted-foreground">{t(($) => $.preflight.styleRule.replaceHint)}</p>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="style-rule-note" className="text-xs text-muted-foreground">{t(($) => $.preflight.styleRule.note)}</label>
            <Input id="style-rule-note" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="style-rule-whole-word" className="text-sm">{t(($) => $.preflight.styleRule.wholeWord)}</label>
            <Switch id="style-rule-whole-word" checked={wholeWord} onCheckedChange={setWholeWord} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="style-rule-case" className="text-sm">{t(($) => $.preflight.styleRule.matchCase)}</label>
            <Switch id="style-rule-case" checked={caseSensitive} onCheckedChange={setCaseSensitive} />
          </div>
          <p className="text-xs text-muted-foreground" data-testid="style-rule-matches" aria-live="polite">
            {matches === 0
              ? t(($) => $.preflight.styleRule.noMatches)
              : t(($) => $.preflight.styleRule.matches, { count: matches })}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              {t(($) => $.preflight.styleRule.cancel)}
            </Button>
            <Button type="submit" size="sm" disabled={!valid || saving} data-testid="style-rule-save">
              {t(($) => $.preflight.styleRule.save)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

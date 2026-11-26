import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import type { ParsedSnippetFile, SnippetProblem } from "@oleafly/snippets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FAST_MATH_COLLECTIONS, setFastMath } from "@/features/snippets/fast-math";
import { collectionName } from "@/features/snippets/records";
import { useSnippetStore } from "@/features/snippets/store";
import { describeError } from "@/lib/app-error";
import { i18n } from "@/i18n";

type Outcome =
  | { kind: "imported"; collection: string; count: number; problems: SnippetProblem[] }
  | { kind: "nothing"; file: string; problems: SnippetProblem[] }
  | { kind: "error"; message: string };

const PACK_DESCRIPTIONS: Readonly<Record<string, () => string>> = {
  "fast-math-latex": () => i18n.t(($) => $.settings.snippets.addDialog.packs.fastMathLatex),
  "fast-math-typst": () => i18n.t(($) => $.settings.snippets.addDialog.packs.fastMathTypst),
  "paper-structure": () => i18n.t(($) => $.settings.snippets.addDialog.packs.paperStructure),
};

function setPack(collection: string, on: boolean): Promise<void> {
  if (collection === FAST_MATH_COLLECTIONS.latex) return setFastMath("latex", on);
  if (collection === FAST_MATH_COLLECTIONS.typst) return setFastMath("typst", on);
  return useSnippetStore.getState().setCollectionEnabled(collection, on);
}

function PackCard({ file, enabled, onError }: Readonly<{ file: ParsedSnippetFile; enabled: boolean; onError: (message: string) => void }>) {
  const { t } = useTranslation(["settings"]);
  const files = useSnippetStore((store) => store.files);
  const name = collectionName(file.collection, files);
  const header = file.header;
  return (
    <div className="space-y-1.5 rounded-lg border p-3" data-testid={`snippet-pack-${file.collection}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <Badge variant="muted" size="sm">
          {t(($) => $.settings.snippets.addDialog.count, { count: file.records.length })}
        </Badge>
        <Switch
          checked={enabled}
          aria-label={t(($) => $.settings.snippets.addDialog.useOn, { name })}
          onCheckedChange={(on) => {
            setPack(file.collection, on).catch((error: unknown) => onError(describeError(error)));
          }}
        />
      </div>
      {PACK_DESCRIPTIONS[file.collection] ? <p className="text-xs text-muted-foreground">{PACK_DESCRIPTIONS[file.collection]()}</p> : null}
      {header?.source || header?.licence ? (
        <p className="text-[0.6875rem] text-muted-foreground">
          {[
            header.source ? t(($) => $.settings.snippets.addDialog.source, { source: header.source }) : null,
            header.licence ? t(($) => $.settings.snippets.addDialog.licence, { licence: header.licence }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function ImportOutcome({ outcome }: Readonly<{ outcome: Outcome }>) {
  const { t } = useTranslation(["settings"]);
  if (outcome.kind === "error") return <InlineAlert>{outcome.message}</InlineAlert>;
  const left = outcome.problems.filter((problem) => problem.severity === "error");
  return (
    <div className="space-y-1.5 text-xs" data-testid="snippet-import-outcome">
      <p className={outcome.kind === "nothing" ? "text-destructive" : undefined}>
        {outcome.kind === "imported"
          ? t(($) => $.settings.snippets.addDialog.imported, { count: outcome.count, collection: outcome.collection })
          : t(($) => $.settings.snippets.addDialog.nothing, { file: outcome.file })}
      </p>
      {left.length > 0 ? (
        <>
          <p className="text-muted-foreground">{t(($) => $.settings.snippets.addDialog.leftOut, { count: left.length })}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {left.map((problem) => (
              <li key={`${problem.line}:${problem.message}`}>{problem.message}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function AddSnippetsDialog({ open, onOpenChange }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const { t } = useTranslation(["settings"]);
  const packs = useSnippetStore((store) => store.packs);
  const disabled = useSnippetStore((store) => store.state.disabledCollections);
  const input = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [packError, setPackError] = useState<string | null>(null);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await useSnippetStore.getState().importVsCodeFile(file.name, await file.text());
      const files = useSnippetStore.getState().files;
      setOutcome(
        parsed.records.length > 0
          ? { kind: "imported", collection: collectionName(parsed.collection, files), count: parsed.records.length, problems: parsed.problems }
          : { kind: "nothing", file: file.name, problems: parsed.problems },
      );
    } catch (error) {
      setOutcome({ kind: "error", message: describeError(error) });
    }
  };

  const change = (next: boolean) => {
    if (!next) {
      setOutcome(null);
      setPackError(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(($) => $.settings.snippets.addDialog.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.settings.snippets.addDialog.packNote)}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="packs" className="space-y-3">
          <TabsList size="sm">
            <TabsTrigger value="packs">{t(($) => $.settings.snippets.addDialog.packsTab)}</TabsTrigger>
            <TabsTrigger value="import">{t(($) => $.settings.snippets.addDialog.importTab)}</TabsTrigger>
          </TabsList>
          <TabsContent value="packs" className="max-h-[50vh] space-y-2 overflow-auto">
            {(packs?.files ?? []).map((file) => (
              <PackCard key={file.collection} file={file} enabled={!disabled.includes(file.collection)} onError={setPackError} />
            ))}
            {packError ? <InlineAlert>{packError}</InlineAlert> : null}
          </TabsContent>
          <TabsContent value="import" className="space-y-3">
            <p className="text-sm text-muted-foreground">{t(($) => $.settings.snippets.addDialog.importIntro)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
              <Upload aria-hidden />
              {t(($) => $.settings.snippets.addDialog.choose)}
            </Button>
            <input
              ref={input}
              className="sr-only"
              type="file"
              accept=".json,.code-snippets,application/json"
              aria-label={t(($) => $.settings.snippets.addDialog.fileLabel)}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void importFile(file);
              }}
            />
            {outcome ? <ImportOutcome outcome={outcome} /> : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

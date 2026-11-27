import type { SnippetLanguage, SnippetRecord } from "@oleafly/snippets";
import { i18n } from "@/i18n";
import { notifyError, toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import { fastMathEnabled, setFastMath } from "./fast-math";
import { collectionName, snippetName } from "./records";
import { useSnippetStore } from "./store";

export { renderSnippetMath } from "./math-preview";
export { projectItems } from "./project-items";

const FRACTION_TIP_AFTER = 3;

let handTypedFractions = 0;

export function snippetCollectionName(collection: string): string {
  return collectionName(collection, useSnippetStore.getState().files);
}

export function noteAutoExpansion(record: SnippetRecord): void {
  const settings = useSettingsStore.getState();
  if (settings.snippetAutoNoteShown) return;
  settings.setSnippetAutoNoteShown(true);
  const trigger = record.regex === null && record.trigger !== null ? record.trigger : snippetName(record);
  toast.info(i18n.t(($) => $.shell.snippets.autoNote, { trigger }));
}

export function offerFastMath(language: SnippetLanguage | null): void {
  if (language !== "latex") return;
  handTypedFractions += 1;
  const settings = useSettingsStore.getState();
  if (handTypedFractions < FRACTION_TIP_AFTER || settings.snippetFastMathTipShown || fastMathEnabled("latex")) return;
  settings.setSnippetFastMathTipShown(true);
  toast.info(i18n.t(($) => $.shell.snippets.fastMathTip), {
    label: i18n.t(($) => $.shell.snippets.turnOnFastMath),
    onClick: () => {
      setFastMath("latex", true).catch((error: unknown) => notifyError("turn on Fast math", error));
    },
  });
}

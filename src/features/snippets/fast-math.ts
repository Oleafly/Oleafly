import { notifyError } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import { type SnippetStore, snippetsReady, useSnippetStore } from "./store";

export type FastMathLanguage = "latex" | "typst";

export const FAST_MATH_COLLECTIONS: Readonly<Record<FastMathLanguage, string>> = {
  latex: "fast-math-latex",
  typst: "fast-math-typst",
};

function enabledIn(store: SnippetStore, language: FastMathLanguage): boolean {
  return store.status === "ready" && !store.state.disabledCollections.includes(FAST_MATH_COLLECTIONS[language]);
}

export function fastMathEnabled(language: FastMathLanguage): boolean {
  return enabledIn(useSnippetStore.getState(), language);
}

export function useFastMath(language: FastMathLanguage): boolean {
  return useSnippetStore((store) => enabledIn(store, language));
}

export function setFastMath(language: FastMathLanguage, on: boolean): Promise<void> {
  if (on && !useSettingsStore.getState().snippetsAuto) useSettingsStore.getState().setSnippetsAuto(true);
  return useSnippetStore.getState().setCollectionEnabled(FAST_MATH_COLLECTIONS[language], on);
}

export function setSnippetCollectionEnabled(collection: string, on: boolean): Promise<void> {
  const language = (Object.keys(FAST_MATH_COLLECTIONS) as FastMathLanguage[]).find(
    (candidate) => FAST_MATH_COLLECTIONS[candidate] === collection,
  );
  return language ? setFastMath(language, on) : useSnippetStore.getState().setCollectionEnabled(collection, on);
}

export async function toggleFastMath(language: FastMathLanguage): Promise<void> {
  try {
    await snippetsReady();
    await setFastMath(language, !fastMathEnabled(language));
  } catch (error) {
    notifyError("toggle Fast math", error);
  }
}

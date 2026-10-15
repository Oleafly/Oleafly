import { useEffect, useReducer } from "react";
import { i18n } from "./index";

export function useCatalogUpdates(namespace: string): void {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const onAdded = (_language: string, added: string) => {
      if (added === namespace) refresh();
    };
    i18n.store.on("added", onAdded);
    return () => i18n.store.off("added", onAdded);
  }, [namespace]);
}

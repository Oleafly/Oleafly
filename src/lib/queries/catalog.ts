import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { staleTimes } from "@/lib/query";
import {
  listFontComponents,
  listTemplatePacks,
  listTemplates,
  refreshPackCatalog,
} from "@/lib/tauri";

export const templatesKey = ["templates"] as const;
export const fontComponentsKey = ["font-components"] as const;
export const templatePacksKey = ["template-packs"] as const;

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: templatesKey,
    queryFn: listTemplates,
    staleTime: staleTimes.templates,
    enabled,
    meta: { silent: true },
  });
}

export function useFontComponents() {
  return useQuery({
    queryKey: fontComponentsKey,
    queryFn: listFontComponents,
    staleTime: staleTimes.templates,
    meta: { silent: true },
  });
}

export function useTemplatePacks() {
  return useQuery({
    queryKey: templatePacksKey,
    // Best-effort CDN catalog refresh first; the bundled catalog still lists
    // offline.
    queryFn: async () => {
      await refreshPackCatalog().catch(() => {});
      return listTemplatePacks();
    },
    staleTime: staleTimes.templates,
    meta: { silent: true },
  });
}

/** Invalidators for the install/remove/import flows that change the catalog. */
export function useInvalidateCatalog() {
  const client = useQueryClient();
  return useMemo(
    () => ({
      templates: () => client.invalidateQueries({ queryKey: templatesKey }),
      fontComponents: () =>
        client.invalidateQueries({ queryKey: fontComponentsKey }),
      templatePacks: () =>
        client.invalidateQueries({ queryKey: templatePacksKey }),
    }),
    [client],
  );
}

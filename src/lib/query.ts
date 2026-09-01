import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { logError } from "@/lib/log";
import { useToastStore } from "@/store/toast";

// Server-state families and how long their data stays fresh. Queries pick the
// family value; anything not listed uses the default below.
export const staleTimes = {
  /** AI model catalog: changes when a provider ships models, not per-click. */
  catalog: 5 * 60_000,
  /** Conference deadlines: refreshed explicitly from the CDN. */
  deadlines: 60 * 60_000,
  /** Template and pack catalog: changes on install/remove, which invalidate. */
  templates: 5 * 60_000,
  /** Project listing: cheap to refetch, mutated from many places. */
  projects: 10_000,
} as const;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

let singleton: QueryClient | null = null;

/** The window's one QueryClient; non-React code (zustand stores) fetches
 * through it so queries and stores share a cache. */
export function appQueryClient(): QueryClient {
  singleton ??= createAppQueryClient();
  return singleton;
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        logError("query", error);
        if (query.meta?.silent) return;
        useToastStore.getState().pushUnique(
          `query:${query.queryHash}`,
          "error",
          describe(error),
        );
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        logError("mutation", error);
        if (mutation.meta?.silent) return;
        useToastStore.getState().push("error", describe(error));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";

export const staleTimes = {
  catalog: 5 * 60_000,
  deadlines: 60 * 60_000,
  templates: 5 * 60_000,
  projects: 10_000,
} as const;

let singleton: QueryClient | null = null;

export function appQueryClient(): QueryClient {
  singleton ??= createAppQueryClient();
  return singleton;
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        void logError("query", error);
        if (query.meta?.notify !== true) return;
        toast.errorUnique(`query:${query.queryHash}`, describeError(error));
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        void logError("mutation", error);
        if (mutation.meta?.silent) return;
        toast.error(describeError(error));
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

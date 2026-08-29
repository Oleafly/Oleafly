import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Venue } from "@/lib/deadlines";
import { staleTimes } from "@/lib/query";
import { readDeadlines, refreshDeadlines } from "@/lib/tauri";

export interface DeadlinesData {
  venues: Venue[];
  generatedAt: string | null;
}

export const deadlinesKey = ["deadlines"] as const;

async function load(): Promise<DeadlinesData> {
  const raw = await readDeadlines();
  const parsed = JSON.parse(raw) as { generated_at?: string; venues?: Venue[] };
  return {
    venues: Array.isArray(parsed.venues) ? parsed.venues : [],
    generatedAt: parsed.generated_at || null,
  };
}

// The view renders its own inline failure notice, so both hooks opt out of
// the global error toast.
export function useDeadlines(enabled: boolean) {
  return useQuery({
    queryKey: deadlinesKey,
    queryFn: load,
    staleTime: staleTimes.deadlines,
    enabled,
    meta: { silent: true },
  });
}

export function useRefreshDeadlines() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await refreshDeadlines();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: deadlinesKey }),
    meta: { silent: true },
  });
}

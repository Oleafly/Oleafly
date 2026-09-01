import { useQuery } from "@tanstack/react-query";
import { staleTimes } from "@/lib/query";
import { listProjects } from "@/lib/tauri";

export const projectsKey = ["projects"] as const;

// The files store still mirrors the listing for its many existing consumers
// (it fetches through the same cache key); new surfaces read this hook.
export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: listProjects,
    staleTime: staleTimes.projects,
    meta: { silent: true },
  });
}

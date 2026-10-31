import { useQuery } from "@tanstack/react-query";
import { staleTimes } from "@/lib/query";
import { listProjects } from "@/lib/tauri";

export const projectsKey = ["projects"] as const;

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: listProjects,
    staleTime: staleTimes.projects,
    meta: { silent: true },
  });
}

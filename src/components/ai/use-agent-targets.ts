import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { i18n } from "@/i18n";
import { acpCatalog } from "@/lib/acp";
import type { DelegationTarget } from "@/lib/agent-mentions";

interface ProviderGroup {
  id: string;
  name: string;
  models: readonly { id: string; name?: string; trust?: string }[];
}

export function useAgentTargets(projectId: string | null, groups: readonly ProviderGroup[]) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["acp", "catalog"] }); };
    window.addEventListener("oleafly:acp-catalog-changed", refresh);
    return () => window.removeEventListener("oleafly:acp-catalog-changed", refresh);
  }, [queryClient]);
  const catalog = useQuery({
    queryKey: ["acp", "catalog"],
    queryFn: () => acpCatalog(false),
    enabled: !!projectId,
    staleTime: 30_000,
    retry: false,
  });
  return useMemo<DelegationTarget[]>(() => [
    ...(catalog.data ?? []).filter((agent) => agent.installed).map((agent) => ({
      id: agent.definition.id,
      label: agent.definition.name,
      detail: i18n.t(($) => $.ai.agents.cliDetail),
      runtime: "acp" as const,
      agentId: agent.definition.id,
      taskUnavailableReason: agent.taskUnavailableReason,
    })),
    ...groups.flatMap((group) => group.models.filter((model) => model.trust !== "blocked").map((model) => ({
      id: `api:${encodeURIComponent(group.id)}:${encodeURIComponent(model.id)}`,
      label: model.name ?? model.id,
      detail: i18n.t(($) => $.ai.agents.builtInDetail, { provider: group.name }),
      runtime: "built-in" as const,
      providerId: group.id,
      modelId: model.id,
    }))),
  ], [catalog.data, groups]);
}

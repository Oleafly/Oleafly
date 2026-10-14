import { useCallback, useEffect, useMemo, useState } from "react";
import { collabAdminOverview, type CollabAdminOverview, type CollabErrorCode } from "@/lib/tauri";
import { collabErrorCode } from "../errors";

export type OverviewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly overview: CollabAdminOverview }
  | { readonly status: "failed"; readonly code: CollabErrorCode };

export function useAdminOverview(serverId: string): { state: OverviewState; reload: () => void } {
  const [state, setState] = useState<OverviewState>({ status: "loading" });
  const [request, setRequest] = useState(0);

  const load = useMemo(() => ({ serverId, request }), [serverId, request]);

  useEffect(() => {
    let active = true;
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    collabAdminOverview(load.serverId).then(
      (overview) => {
        if (active) setState({ status: "ready", overview });
      },
      (error: unknown) => {
        if (active) setState({ status: "failed", code: collabErrorCode(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const reload = useCallback(() => setRequest((count) => count + 1), []);
  return { state, reload };
}

import { useCallback, useEffect, useState } from "react";
import { collabAdminOverview, type CollabAdminOverview, type CollabErrorCode } from "@/lib/tauri";
import { collabErrorCode } from "../errors";

export type OverviewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly overview: CollabAdminOverview }
  | { readonly status: "failed"; readonly code: CollabErrorCode };

export function useAdminOverview(serverId: string): { state: OverviewState; reload: () => void } {
  const [state, setState] = useState<OverviewState>({ status: "loading" });
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let active = true;
    void request;
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    collabAdminOverview(serverId).then(
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
  }, [serverId, request]);

  const reload = useCallback(() => setRequest((count) => count + 1), []);
  return { state, reload };
}

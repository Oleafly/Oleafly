import { useCallback, useEffect, useMemo, useState } from "react";
import type { CollabMember } from "@/lib/tauri";
import { collabAdminMembers } from "@/lib/tauri-collab";
import { collabErrorText } from "./errors";
import type { MembersUpdate } from "./MembersTab";

export interface ServerMembers {
  readonly members: CollabMember[] | null;
  readonly loadError: string | null;
  readonly retry: () => void;
  readonly update: MembersUpdate;
}

export function useServerMembers(serverId: string): ServerMembers {
  const [members, setMembers] = useState<CollabMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);

  const load = useMemo(() => ({ serverId, request }), [serverId, request]);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    collabAdminMembers(load.serverId).then(
      (next) => {
        if (active) setMembers(next);
      },
      (error: unknown) => {
        if (active) setLoadError(collabErrorText(error));
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const retry = useCallback(() => setRequest((count) => count + 1), []);
  const update = useCallback<MembersUpdate>(
    (change) => setMembers((current) => (current === null ? current : change(current))),
    [],
  );

  return { members, loadError, retry, update };
}

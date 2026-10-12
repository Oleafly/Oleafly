import { useCallback, useEffect, useState } from "react";
import { collabAdminMembers, type CollabMember } from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "./errors";
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

  useEffect(() => {
    let active = true;
    void request;
    setLoadError(null);
    collabAdminMembers(serverId).then(
      (next) => {
        if (active) setMembers(next);
      },
      (error: unknown) => {
        if (active) setLoadError(collabErrorMessage(collabErrorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [serverId, request]);

  const retry = useCallback(() => setRequest((count) => count + 1), []);
  const update = useCallback<MembersUpdate>(
    (change) => setMembers((current) => (current === null ? current : change(current))),
    [],
  );

  return { members, loadError, retry, update };
}

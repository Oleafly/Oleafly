import { useCallback, useEffect, useMemo, useState } from "react";
import type { CollabPublishedNote, CollabPublishedNotes } from "@oleafly/backend-port";
import { collabPublishedNotes } from "@/lib/tauri-collab";
import { collabErrorCode, collabErrorText } from "../errors";

type PublishedListing =
  | { kind: "loading" }
  | { kind: "ready"; listing: CollabPublishedNotes }
  | { kind: "unsupported" }
  | { kind: "failed"; message: string };

export function usePublishedNotes(serverId: string | null): {
  state: PublishedListing;
  reload: () => void;
  put: (note: CollabPublishedNote) => void;
  drop: (id: string) => void;
} {
  const [state, setState] = useState<PublishedListing>({ kind: "loading" });
  const [request, setRequest] = useState(0);

  const load = useMemo(() => ({ serverId, request }), [serverId, request]);

  useEffect(() => {
    if (!load.serverId) return;
    let active = true;
    setState({ kind: "loading" });
    collabPublishedNotes(load.serverId).then(
      (listing) => {
        if (active) setState({ kind: "ready", listing });
      },
      (error: unknown) => {
        if (!active) return;
        if (collabErrorCode(error) === "not_found") setState({ kind: "unsupported" });
        else setState({ kind: "failed", message: collabErrorText(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const edit = useCallback((change: (notes: CollabPublishedNote[]) => CollabPublishedNote[]) => {
    setState((current) =>
      current.kind === "ready" ? { kind: "ready", listing: { ...current.listing, notes: change(current.listing.notes) } } : current,
    );
  }, []);
  const reload = useCallback(() => setRequest((count) => count + 1), []);
  const put = useCallback(
    (note: CollabPublishedNote) => edit((notes) => [note, ...notes.filter((entry) => entry.id !== note.id)]),
    [edit],
  );
  const drop = useCallback((id: string) => edit((notes) => notes.filter((entry) => entry.id !== id)), [edit]);
  return { state, reload, put, drop };
}

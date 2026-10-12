import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { PeerMarks } from "@/components/collab/CollabSlots";
import { useCollabLiveStore } from "../live/live-store";
import { peerMarks } from "./presence";

const NO_MARKS: PeerMarks = new Map();

export function TreePresence({ onChange }: Readonly<{ onChange: (marks: PeerMarks) => void }>) {
  const { t } = useTranslation(["collab"]);
  const live = useCollabLiveStore(
    useShallow((state) => ({
      peers: state.peers,
      members: state.members,
      selfId: state.share?.account_id ?? null,
    })),
  );
  const unknownName = t(($) => $.collab.toolbar.unknownPerson);
  const marks = useMemo(
    () =>
      peerMarks(live.peers, live.members, live.selfId, unknownName, (name) =>
        t(($) => $.collab.tree.here, { name }),
      ),
    [live.peers, live.members, live.selfId, unknownName, t],
  );

  useEffect(() => {
    onChange(marks);
  }, [marks, onChange]);

  useEffect(() => () => onChange(NO_MARKS), [onChange]);

  return null;
}

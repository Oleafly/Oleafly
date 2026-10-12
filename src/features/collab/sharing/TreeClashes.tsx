import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTreeClashes } from "@/components/collab/tree-clashes";
import { logError } from "@/lib/log";
import { collabTreeClashes, type CollabTreeClash } from "@/lib/tauri";
import { useLiveTree } from "./tree-version";

const NONE: readonly CollabTreeClash[] = [];
const NO_LABELS: ReadonlyMap<string, string> = new Map();

export function TreeClashes() {
  const { t } = useTranslation(["collab"]);
  const tree = useLiveTree();
  const projectId = tree?.projectId ?? null;
  const [found, setFound] = useState<{ projectId: string | null; clashes: readonly CollabTreeClash[] }>({
    projectId: null,
    clashes: NONE,
  });

  useEffect(() => {
    if (!tree) return;
    const { projectId } = tree;
    let current = true;
    collabTreeClashes(projectId).then(
      (clashes) => {
        if (current) setFound({ projectId, clashes });
      },
      (error: unknown) => {
        void logError("collab tree clashes", error);
      },
    );
    return () => {
      current = false;
    };
  }, [tree]);

  const clashes = found.projectId === projectId ? found.clashes : NONE;
  const labels = useMemo(
    () =>
      clashes.length === 0
        ? NO_LABELS
        : new Map(
            clashes.map((clash) => [
              clash.path,
              t(($) => $.collab.tree.clash, { other: clash.other, name: clash.name }),
            ]),
          ),
    [clashes, t],
  );

  useEffect(() => {
    useTreeClashes.setState({ labels });
  }, [labels]);

  useEffect(() => () => useTreeClashes.setState({ labels: NO_LABELS }), []);

  return null;
}

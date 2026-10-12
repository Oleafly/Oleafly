import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { logError } from "@/lib/log";
import { collabPendingLinks, onCollabOpenLink } from "@/lib/tauri";

const LinkIntake = lazy(() =>
  import("@/features/collab/links/LinkIntake").then((module) => ({ default: module.LinkIntake })),
);

export function CollabLinkKeeper() {
  const [inbox, setInbox] = useState<readonly string[] | null>(null);
  const taken = useCallback((count: number) => setInbox((links) => links?.slice(count) ?? links), []);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let stop: (() => void) | undefined;
    const drain = () => {
      collabPendingLinks().then(
        (links) => {
          if (links.length > 0) setInbox((current) => [...(current ?? []), ...links]);
        },
        (error: unknown) => logError("collab pending links", error),
      );
    };
    onCollabOpenLink(drain)
      .then(
        (unlisten) => {
          if (active) stop = unlisten;
          else unlisten();
        },
        (error: unknown) => logError("collab link listener", error),
      )
      .finally(() => {
        if (active) drain();
      });
    return () => {
      active = false;
      stop?.();
    };
  }, []);

  return inbox ? (
    <Suspense fallback={null}>
      <LinkIntake links={inbox} onTaken={taken} />
    </Suspense>
  ) : null;
}

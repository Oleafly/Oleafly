import { Suspense, useState, type ComponentType } from "react";

/**
 * Mounts a lazy surface the first time it opens, so its chunk stays off the
 * startup path, and keeps it mounted after that, so closing still animates and
 * a reopened modal keeps its state. Each gets its own boundary: one arriving
 * later must not blank one already on screen. The fallback stays null.
 */
export function mountOnFirstOpen(Surface: ComponentType, useOpen: () => boolean) {
  return function MountOnFirstOpen() {
    const open = useOpen();
    const [opened, setOpened] = useState(open);
    if (open && !opened) setOpened(true);
    if (!open && !opened) return null;
    return (
      <Suspense fallback={null}>
        <Surface />
      </Suspense>
    );
  };
}

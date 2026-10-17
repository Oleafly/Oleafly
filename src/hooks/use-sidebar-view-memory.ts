import { useLayoutEffect, useRef } from "react";
import {
  type SidebarViewKey,
  type SidebarViewStates,
  writeSidebarView,
} from "@/store/sidebar-view-state";

type MemoryValue<Key extends SidebarViewKey> =
  | SidebarViewStates[Key]
  | (() => SidebarViewStates[Key]);

export function useSidebarViewMemory<Key extends SidebarViewKey>(
  projectId: string | null,
  key: Key,
  value: MemoryValue<Key>,
): void {
  const latest = useRef(value);
  latest.current = value;
  useLayoutEffect(
    () => () => {
      const current = latest.current;
      writeSidebarView(
        projectId,
        key,
        typeof current === "function" ? current() : current,
      );
    },
    [projectId, key],
  );
}

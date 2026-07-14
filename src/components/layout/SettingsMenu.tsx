import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import { useSettingsStore } from "@/store/settings";

export function SettingsMenu({ trigger }: { trigger?: ReactNode }) {
  const setOpen = useSettingsStore((s) => s.setSettingsOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Settings"
      title="Settings"
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {trigger ?? <Settings className="size-4" />}
    </button>
  );
}

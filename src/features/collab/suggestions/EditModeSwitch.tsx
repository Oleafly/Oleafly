import { useTranslation } from "react-i18next";
import { MessageSquareDiff, PencilLine } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Tooltip } from "@/components/ui/tooltip";
import type { CollabEditMode } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useCollabLiveStore } from "../live/live-store";
import { canSuggestProjectRole, suggestsOnlyProjectRole } from "../roles";
import { editModeSwitchable, setEditMode, useEditMode } from "./edit-mode";

const OPTIONS = [
  { mode: "editing", icon: PencilLine },
  { mode: "suggesting", icon: MessageSquareDiff },
] as const satisfies readonly { mode: CollabEditMode; icon: typeof PencilLine }[];

export function EditModeSwitch({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["collab"]);
  const role = useCollabLiveStore((state) => (state.projectId === projectId && state.share ? state.role : null));
  const edit = useEditMode(useShallow((state) => ({ projectId: state.projectId, mode: state.mode, busy: state.busy })));
  if (!canSuggestProjectRole(role) || edit.projectId !== projectId) return null;
  if (suggestsOnlyProjectRole(role)) {
    const hint = t(($) => $.collab.suggestions.mode.reviewerHint);
    return (
      <div data-toolbar-item="suggesting" className="flex w-max shrink-0 items-center">
        <Tooltip label={hint} side="bottom" wide>
          <span
            role="status"
            aria-label={hint}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-primary/10 px-2 text-xs font-medium text-foreground"
          >
            <MessageSquareDiff aria-hidden className="size-3.5" />
            {t(($) => $.collab.suggestions.mode.suggesting)}
          </span>
        </Tooltip>
      </div>
    );
  }
  if (!editModeSwitchable(role) || edit.mode === null) return null;
  const hints: Readonly<Record<CollabEditMode, string>> = {
    editing: t(($) => $.collab.suggestions.mode.editingHint),
    suggesting: t(($) => $.collab.suggestions.mode.suggestingHint),
  };
  const labels: Readonly<Record<CollabEditMode, string>> = {
    editing: t(($) => $.collab.suggestions.mode.editing),
    suggesting: t(($) => $.collab.suggestions.mode.suggesting),
  };
  return (
    <div data-toolbar-item="suggesting" className="flex w-max shrink-0 items-center">
      <fieldset
        aria-label={t(($) => $.collab.suggestions.mode.label)}
        className="m-0 flex items-center rounded-md border border-border bg-muted/40 p-0.5"
      >
        {OPTIONS.map(({ mode, icon: Icon }) => {
          const active = edit.mode === mode;
          return (
            <Tooltip key={mode} label={hints[mode]} side="bottom" wide>
              <button
                type="button"
                aria-label={labels[mode]}
                aria-pressed={active}
                disabled={edit.busy}
                onClick={() => void setEditMode(mode)}
                className={cn(
                  "flex size-7 items-center justify-center rounded transition-colors disabled:pointer-events-none",
                  active
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            </Tooltip>
          );
        })}
      </fieldset>
    </div>
  );
}

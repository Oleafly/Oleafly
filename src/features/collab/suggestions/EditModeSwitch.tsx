import { useTranslation } from "react-i18next";
import { ChevronDown, MessageSquareDiff, PencilLine } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import type { CollabEditMode, CollabEditModeLock } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { liveReviewProjectId, useCollabLiveStore } from "../live/live-store";
import { canSuggestProjectRole, suggestsOnlyProjectRole } from "../roles";
import { type EditModeState, setEditMode, useEditMode } from "./edit-mode";

const OPTIONS = [
  { mode: "editing", icon: PencilLine },
  { mode: "suggesting", icon: MessageSquareDiff },
] as const satisfies readonly { mode: CollabEditMode; icon: typeof PencilLine }[];

type Translate = ReturnType<typeof useTranslation<["collab"]>>["t"];

function modeLabel(mode: CollabEditMode, t: Translate): string {
  return mode === "editing" ? t(($) => $.collab.suggestions.mode.editing) : t(($) => $.collab.suggestions.mode.suggesting);
}

function modeHint(mode: CollabEditMode, t: Translate): string {
  return mode === "editing"
    ? t(($) => $.collab.suggestions.mode.editingHint)
    : t(($) => $.collab.suggestions.mode.suggestingHint);
}

function lockedHint(locked: CollabEditModeLock | null, mode: CollabEditMode, t: Translate): string {
  switch (locked) {
    case "reviewer":
      return t(($) => $.collab.suggestions.mode.reviewerHint);
    case "everyone":
      return t(($) => $.collab.suggestions.mode.locked.everyone);
    case "plan":
      return t(($) => $.collab.suggestions.mode.locked.plan);
    case "server":
      return t(($) => $.collab.suggestions.mode.locked.server);
    default:
      return modeHint(mode, t);
  }
}

function LockedMode({ mode, hint }: Readonly<{ mode: CollabEditMode; hint: string }>) {
  const { t } = useTranslation(["collab"]);
  const Icon = mode === "editing" ? PencilLine : MessageSquareDiff;
  return (
    <Tooltip label={hint} side="bottom" wide>
      <output
        aria-label={hint}
        className={cn(
          "flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-foreground",
          mode === "suggesting" ? "bg-primary/10" : "bg-muted/40",
        )}
      >
        <Icon aria-hidden className="size-3.5" />
        {modeLabel(mode, t)}
      </output>
    </Tooltip>
  );
}

function ModeButtons({ mode, busy }: Readonly<{ mode: CollabEditMode; busy: boolean }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <fieldset
      aria-label={t(($) => $.collab.suggestions.mode.label)}
      className="m-0 flex items-center rounded-md border border-border bg-muted/40 p-0.5"
    >
      {OPTIONS.map(({ mode: option, icon: Icon }) => {
        const active = mode === option;
        return (
          <Tooltip key={option} label={modeHint(option, t)} side="bottom" wide>
            <button
              type="button"
              aria-label={modeLabel(option, t)}
              aria-pressed={active}
              disabled={busy}
              onClick={() => void setEditMode(option)}
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
  );
}

function OthersMenu({ edit }: Readonly<{ edit: Pick<EditModeState, "everyone" | "guests" | "busy"> }>) {
  const { t } = useTranslation(["collab"]);
  const label = t(($) => $.collab.suggestions.mode.others);
  const toggle = (scope: "everyone" | "guests") => (checked: boolean) =>
    void setEditMode(checked ? "suggesting" : "editing", scope);
  return (
    <DropdownMenu>
      <Tooltip label={label} side="bottom">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="flex h-7 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
          >
            <ChevronDown aria-hidden className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {edit.everyone === null ? null : (
          <DropdownMenuCheckboxItem
            checked={edit.everyone}
            disabled={edit.busy}
            onCheckedChange={toggle("everyone")}
          >
            {t(($) => $.collab.suggestions.mode.forEveryone)}
          </DropdownMenuCheckboxItem>
        )}
        {edit.guests === null ? null : (
          <DropdownMenuCheckboxItem checked={edit.guests} disabled={edit.busy} onCheckedChange={toggle("guests")}>
            {t(($) => $.collab.suggestions.mode.forGuests)}
          </DropdownMenuCheckboxItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditModeSwitch({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["collab"]);
  const role = useCollabLiveStore((state) => (liveReviewProjectId(state) === projectId ? state.role : null));
  const edit = useEditMode(
    useShallow((state) => ({
      projectId: state.projectId,
      mode: state.mode,
      switchable: state.switchable,
      locked: state.locked,
      everyone: state.everyone,
      guests: state.guests,
      manage: state.manage,
      busy: state.busy,
    })),
  );
  if (!canSuggestProjectRole(role) || edit.projectId !== projectId) return null;
  const reviewer = suggestsOnlyProjectRole(role);
  const mode = reviewer ? "suggesting" : edit.mode;
  if (mode === null) return null;
  const others = edit.manage && (edit.everyone !== null || edit.guests !== null);
  return (
    <div data-toolbar-item="suggesting" className="flex w-max shrink-0 items-center gap-0.5">
      {edit.switchable && !reviewer ? (
        <ModeButtons mode={mode} busy={edit.busy} />
      ) : (
        <LockedMode mode={mode} hint={lockedHint(reviewer ? "reviewer" : edit.locked, mode, t)} />
      )}
      {others ? <OthersMenu edit={edit} /> : null}
    </div>
  );
}

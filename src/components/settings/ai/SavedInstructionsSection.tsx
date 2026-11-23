import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { describeError } from "@/lib/app-error";
import {
  canSaveMore,
  newSavedInstruction,
  rankSavedInstructions,
  SAVED_INSTRUCTION_LIMITS,
  savedInstructionsOf,
  usesOf,
} from "@/lib/saved-instructions";
import type { AppConfig, SavedInstruction } from "@/lib/tauri";
import { SAVED_INSTRUCTIONS_TARGET } from "../ai-settings-navigation";
import { SettingsRow } from "../SettingsRow";

const ADDING = "adding";

interface Draft {
  name: string;
  text: string;
}

function InstructionForm({
  initial,
  onSubmit,
  onCancel,
}: Readonly<{
  initial: Draft;
  onSubmit: (draft: Draft) => Promise<string | null>;
  onCancel: () => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
  }, []);
  const submit = async () => {
    if (!draft.name.trim() || !draft.text.trim()) {
      setError(t(($) => $.settings.ai.instructions.savedInstructions.required));
      return;
    }
    setBusy(true);
    const failure = await onSubmit(draft);
    setBusy(false);
    if (failure) setError(failure);
  };
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3" data-testid="saved-instruction-form">
      <Input
        ref={nameRef}
        value={draft.name}
        maxLength={SAVED_INSTRUCTION_LIMITS.name}
        onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        aria-label={t(($) => $.settings.ai.instructions.savedInstructions.name)}
        placeholder={t(($) => $.settings.ai.instructions.savedInstructions.namePlaceholder)}
        className="h-8 text-xs"
      />
      <Textarea
        value={draft.text}
        maxLength={SAVED_INSTRUCTION_LIMITS.text}
        onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
        rows={3}
        aria-label={t(($) => $.settings.ai.instructions.savedInstructions.text)}
        placeholder={t(($) => $.settings.ai.instructions.savedInstructions.textPlaceholder)}
        className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed"
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void submit()}>
          {t(($) => $.common.actions.save)}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t(($) => $.common.actions.cancel)}
        </Button>
      </div>
    </div>
  );
}

export function SavedInstructionsSection({
  cfg,
  configLoaded,
  persist,
}: Readonly<{
  cfg: AppConfig;
  configLoaded: boolean;
  persist: (next: AppConfig) => Promise<void>;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedInstruction | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const list = savedInstructionsOf(cfg);
  const ranked = rankSavedInstructions(cfg);
  const room = canSaveMore(cfg);

  const write = async (next: SavedInstruction[]): Promise<string | null> => {
    try {
      await persist({ ...cfg, ai_saved_instructions: next });
      return null;
    } catch (error) {
      return describeError(error);
    }
  };

  const submit = (id: string | null) => async (draft: Draft) => {
    const entry = newSavedInstruction(draft.name, draft.text);
    const next = id
      ? list.map((instruction) => (instruction.id === id ? { ...entry, id } : instruction))
      : [...list, entry];
    const failure = await write(next);
    if (!failure) setEditing(null);
    return failure;
  };

  const remove = async (target: SavedInstruction) => {
    const failure = await write(list.filter((instruction) => instruction.id !== target.id));
    setDeleteError(failure ?? "");
  };

  return (
    <div id={SAVED_INSTRUCTIONS_TARGET} className="space-y-2 border-t pt-4" data-testid={SAVED_INSTRUCTIONS_TARGET}>
      <p className="font-medium">{t(($) => $.settings.ai.instructions.savedInstructions.title)}</p>
      <p className="text-xs text-muted-foreground">{t(($) => $.settings.ai.instructions.savedInstructions.description)}</p>
      {ranked.length === 0 && editing !== ADDING ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.ai.instructions.savedInstructions.empty)}</p>
      ) : null}
      {ranked.length > 0 ? (
        <div className="space-y-1.5">
          {ranked.map((instruction) =>
            editing === instruction.id ? (
              <InstructionForm
                key={instruction.id}
                initial={{ name: instruction.name, text: instruction.text }}
                onSubmit={submit(instruction.id)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <SettingsRow
                key={instruction.id}
                testId={`saved-instruction-${instruction.id}`}
                label={<span className="break-words">{instruction.name}</span>}
                adornment={
                  usesOf(cfg, instruction.id) > 0 ? (
                    <Badge variant="muted" size="sm">
                      {t(($) => $.settings.ai.instructions.savedInstructions.uses, { count: usesOf(cfg, instruction.id) })}
                    </Badge>
                  ) : undefined
                }
                description={
                  <span className="line-clamp-3 whitespace-pre-wrap">{instruction.text}</span>
                }
                control={
                  <div className="flex shrink-0 items-center gap-1">
                    <TooltipIconButton
                      label={t(($) => $.settings.ai.instructions.savedInstructions.editNamed, { name: instruction.name })}
                      tooltip={t(($) => $.common.actions.edit)}
                      disabled={!configLoaded}
                      onClick={() => setEditing(instruction.id)}
                    >
                      <Pencil />
                    </TooltipIconButton>
                    <TooltipIconButton
                      label={t(($) => $.settings.ai.instructions.savedInstructions.deleteNamed, { name: instruction.name })}
                      tooltip={t(($) => $.common.actions.delete)}
                      disabled={!configLoaded}
                      onClick={() => setConfirmDelete(instruction)}
                      className="hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 />
                    </TooltipIconButton>
                  </div>
                }
              />
            ),
          )}
        </div>
      ) : null}
      {editing === ADDING ? (
        <InstructionForm
          initial={{ name: "", text: "" }}
          onSubmit={submit(null)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Button size="sm" variant="outline" disabled={!configLoaded || !room} onClick={() => setEditing(ADDING)}>
          <Plus className="size-3.5" />
          {t(($) => $.settings.ai.instructions.savedInstructions.add)}
        </Button>
      )}
      {room ? null : (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.ai.instructions.savedInstructions.limit, { max: SAVED_INSTRUCTION_LIMITS.count })}
        </p>
      )}
      {deleteError ? <p className="text-xs text-destructive">{deleteError}</p> : null}
      <ConfirmationDialog
        open={confirmDelete !== null}
        title={t(($) => $.settings.ai.instructions.savedInstructions.deleteTitle)}
        description={t(($) => $.settings.ai.instructions.savedInstructions.deleteDescription, {
          name: confirmDelete?.name ?? "",
        })}
        confirmLabel={t(($) => $.common.actions.delete)}
        destructive
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import type { AppConfig, Persona } from "@/lib/tauri";
import { personaGradient } from "@/lib/persona-colors";
import {
  isStarterPersonaInstalled,
  STARTER_PERSONAS,
  type StarterPersona,
} from "@/lib/starter-personas";
import { CreatePersonaDialog } from "./CreatePersonaDialog";

export interface PersonasTabProps {
  cfg: AppConfig;
  persist: (next: AppConfig) => Promise<void>;
  setMsg: (msg: { ok: boolean; text: string } | null) => void;
}

export function PersonasTab({ cfg, persist, setMsg }: PersonasTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Persona | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Persona | null>(null);
  const [addingStarterId, setAddingStarterId] = useState<string | null>(null);
  const personas = cfg.ai_personas ?? [];
  const availableStarters = STARTER_PERSONAS.filter(
    (starter) => !isStarterPersonaInstalled(personas, starter),
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (persona: Persona) => {
    setEditing(persona);
    setDialogOpen(true);
  };

  const savePersona = async (persona: Persona): Promise<{ ok: boolean; message?: string }> => {
    const exists = personas.some((p) => p.id === persona.id);
    const nextPersonas = exists
      ? personas.map((p) => (p.id === persona.id ? persona : p))
      : [...personas, persona];
    try {
      await persist({ ...cfg, ai_personas: nextPersonas });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  };

  const deletePersona = async (persona: Persona) => {
    try {
      await persist({ ...cfg, ai_personas: personas.filter((p) => p.id !== persona.id) });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  const addStarterPersona = async (starter: StarterPersona) => {
    setAddingStarterId(starter.id);
    setMsg(null);
    try {
      const persona: Persona = {
        id: starter.id,
        name: starter.name,
        color: starter.color,
        prompt: starter.prompt,
      };
      await persist({ ...cfg, ai_personas: [...personas, persona] });
    } catch (e) {
      setMsg({ ok: false, text: `Could not add ${starter.name}. ${String(e)}` });
    } finally {
      setAddingStarterId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">Personas</p>
        <p className="text-xs text-muted-foreground">
          Reusable instructions for how the assistant should work. Choose one in chat
          for a task. While selected, it replaces your default instructions.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" data-testid="ai-create-persona" data-tour="ai-create-persona" onClick={openCreate}>
          <Plus className="size-3.5" />
          Create persona
        </Button>
      </div>

      {personas.length === 0 ? (
        <p data-testid="ai-personas-empty" className="text-xs text-muted-foreground">
          No personas added yet.
        </p>
      ) : (
        <div className="space-y-1">
          {personas.map((persona) => (
            <div
              key={persona.id}
              data-testid={`ai-persona-row-${persona.name}`}
              className="flex items-start gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border"
            >
              <span
                className="mt-1 size-3 shrink-0 rounded-full"
                style={{ background: personaGradient(persona.color) }}
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{persona.name}</span>
                {persona.prompt.trim() && (
                  <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap text-[11px] leading-snug text-muted-foreground">
                    {persona.prompt}
                  </span>
                )}
              </div>
              <Tooltip label="Edit persona">
                <button
                  type="button"
                  data-testid={`ai-persona-edit-${persona.name}`}
                  aria-label={`Edit persona ${persona.name}`}
                  onClick={() => openEdit(persona)}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="size-3" />
                </button>
              </Tooltip>
              <Tooltip label="Delete persona">
                <button
                  type="button"
                  data-testid={`ai-persona-delete-${persona.name}`}
                  aria-label={`Delete persona ${persona.name}`}
                  onClick={() => setConfirmDelete(persona)}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}

      {availableStarters.length > 0 ? (
        <div className="space-y-2 pt-2">
          <div>
            <p className="text-xs font-medium">Suggested personas</p>
            <p className="text-xs text-muted-foreground">
              Start with one of these, then edit its instructions to fit your workflow.
            </p>
          </div>
          <div className="space-y-1.5">
            {availableStarters.map((starter) => {
              const isAdding = addingStarterId === starter.id;
              return (
                <div
                  key={starter.id}
                  data-testid={`ai-starter-persona-${starter.id}`}
                  className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
                >
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: personaGradient(starter.color) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">{starter.name}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {starter.description}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Add ${starter.name} persona`}
                    disabled={addingStarterId !== null}
                    onClick={() => void addStarterPersona(starter)}
                  >
                    {isAdding ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Add persona
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <CreatePersonaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={savePersona}
        editing={editing}
      />

      <ConfirmationDialog
        open={confirmDelete !== null}
        title="Delete persona"
        description={`Delete "${confirmDelete?.name ?? ""}"? Its prompt is removed permanently, and any chat using it falls back to your default instructions.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (confirmDelete) void deletePersona(confirmDelete);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

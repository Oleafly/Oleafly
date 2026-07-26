import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppConfig, Persona } from "@/lib/tauri";
import { personaGradient } from "@/lib/persona-colors";
import { CreatePersonaDialog } from "./CreatePersonaDialog";

export interface PersonasTabProps {
  cfg: AppConfig;
  persist: (next: AppConfig) => Promise<void>;
  setMsg: (msg: { ok: boolean; text: string } | null) => void;
}

export function PersonasTab({ cfg, persist, setMsg }: PersonasTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Persona | null>(null);
  const personas = cfg.ai_personas ?? [];

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">Personas</p>
          <p className="text-xs text-muted-foreground">
            Named, colored prompts you can switch on from the chat panel instead of your
            default custom instructions.
          </p>
        </div>
        <Button size="sm" data-testid="ai-create-persona" onClick={openCreate}>
          <Plus className="size-3.5" />
          Create persona
        </Button>
      </div>

      {personas.length === 0 ? (
        <p data-testid="ai-personas-empty" className="text-xs text-muted-foreground">
          No personas yet. Create one to get started.
        </p>
      ) : (
        <div className="space-y-1">
          {personas.map((persona) => (
            <div
              key={persona.id}
              data-testid={`ai-persona-row-${persona.name}`}
              className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border"
            >
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ background: personaGradient(persona.color) }}
              />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{persona.name}</span>
              <button
                type="button"
                data-testid={`ai-persona-edit-${persona.name}`}
                aria-label={`Edit persona ${persona.name}`}
                title="Edit persona"
                onClick={() => openEdit(persona)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="size-3" />
              </button>
              <button
                type="button"
                data-testid={`ai-persona-delete-${persona.name}`}
                aria-label={`Delete persona ${persona.name}`}
                title="Delete persona"
                onClick={() => void deletePersona(persona)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <CreatePersonaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={savePersona}
        editing={editing}
      />
    </div>
  );
}

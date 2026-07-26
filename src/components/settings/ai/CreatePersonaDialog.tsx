import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERSONA_COLORS, personaGradient } from "@/lib/persona-colors";
import type { Persona } from "@/lib/tauri";

export interface CreatePersonaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Persists the persona (append for a new one, replace for an edit) into
  // ai_personas. Returning ok: false keeps the dialog open with the message.
  onSubmit: (persona: Persona) => Promise<{ ok: boolean; message?: string }>;
  // When set, the dialog edits this persona in place instead of creating one.
  editing?: Persona | null;
}

interface FormState {
  name: string;
  color: string;
  prompt: string;
}

const EMPTY_FORM: FormState = { name: "", color: PERSONA_COLORS[0].key, prompt: "" };

export function CreatePersonaDialog({ open, onOpenChange, onSubmit, editing }: CreatePersonaDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? { name: editing.name, color: editing.color, prompt: editing.prompt }
        : EMPTY_FORM
    );
    setError("");
    setBusy(false);
  }, [open, editing]);

  const submit = async () => {
    const name = form.name.trim();
    const prompt = form.prompt.trim();
    if (!name || !prompt) {
      setError("Name and prompt are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const persona: Persona = {
        id: editing?.id ?? crypto.randomUUID(),
        name,
        color: form.color,
        prompt,
      };
      const res = await onSubmit(persona);
      if (!res.ok) {
        setError(res.message ?? "Could not save that persona.");
        return;
      }
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[120]"
        overlayClassName="z-[120]"
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? "Edit persona" : "Create persona"}</DialogTitle>
          <DialogDescription>
            A named, colored prompt you can switch on from the chat panel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="persona-name" className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              id="persona-name"
              data-testid="persona-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Terse Editor"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="persona-color" className="text-xs font-medium text-muted-foreground">
              Color
            </label>
            <Select value={form.color} onValueChange={(color) => setForm((f) => ({ ...f, color }))}>
              <SelectTrigger id="persona-color" data-testid="persona-color">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[130]">
                {PERSONA_COLORS.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ background: personaGradient(c.key) }}
                      />
                      {c.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="persona-prompt" className="text-xs font-medium text-muted-foreground">
              Prompt
            </label>
            <Textarea
              id="persona-prompt"
              data-testid="persona-prompt"
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              rows={5}
              placeholder="Reply in at most two sentences."
              className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button data-testid="persona-submit" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {editing ? "Save" : "Create"}
            <Kbd className="bg-background/25 text-current">↵</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { personaGradient } from "@/lib/persona-colors";
import type { Persona } from "@/lib/tauri";

export function PersonaPicker({
  personas,
  value,
  onChange,
  className,
}: {
  personas: Persona[];
  value: string | null;
  onChange: (personaId: string | null) => void;
  className?: string;
}) {
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(next) => onChange(next === "none" ? null : next)}
    >
      <Tooltip label="Switch persona">
        <SelectTrigger
          data-testid="ai-persona-picker"
          aria-label="Persona"
          className={cn(
            "h-6 max-w-40 border-0 bg-transparent px-1.5 text-[10px] text-muted-foreground shadow-none hover:bg-accent hover:text-foreground",
            className,
          )}
        >
          <SelectValue />
        </SelectTrigger>
      </Tooltip>
      <SelectContent className="max-h-[60vh] min-w-48">
        <SelectItem value="none">None</SelectItem>
        {personas.map((persona) => (
          <SelectItem key={persona.id} value={persona.id}>
            <span className="flex items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ background: personaGradient(persona.color) }}
              />
              {persona.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

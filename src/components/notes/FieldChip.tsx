import { cn } from "@/lib/utils";
import { type FieldDisplay, fieldData } from "./note-fields";

export function FieldChip({
  display,
  inline = false,
  match = false,
}: Readonly<{ display: FieldDisplay; inline?: boolean; match?: boolean }>) {
  return (
    <span className={cn("note-field", inline && "note-field-inline")} data-match={match ? "" : undefined} {...fieldData(display)}>
      {display.icon && <display.icon aria-hidden className="note-field-icon" />}
      <span className={display.icon ? "sr-only" : "note-field-key"}>{display.key}</span>
      <span className="note-field-value">{display.value}</span>
    </span>
  );
}

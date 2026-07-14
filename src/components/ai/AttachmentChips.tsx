import { X, FileText } from "lucide-react";

export interface PendingAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
}

// Modeled on the AI SDK Elements "Attachments" inline variant.
export function AttachmentChips({
  items,
  onRemove,
}: {
  items: PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {items.map((a) => (
        <div
          key={a.id}
          className="relative flex items-center gap-1.5 rounded-md border bg-muted/50 py-1 pl-1.5 pr-6 text-xs"
        >
          {a.mediaType.startsWith("image/") ? (
            <img src={a.dataUrl} alt={a.name} className="size-6 rounded object-cover" />
          ) : (
            <FileText className="size-4 text-muted-foreground" />
          )}
          <span className="max-w-[140px] truncate">{a.name}</span>
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            aria-label={`Remove ${a.name}`}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

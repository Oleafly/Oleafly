import { X, FileText } from "lucide-react";

/** A file/image staged in the composer (bytes held only until send). */
export interface PendingAttachment {
  id: string;
  name: string;
  mediaType: string;
  /** data: URL — used for the model call and the image thumbnail. */
  dataUrl: string;
}

/**
 * Composer attachment chips, modeled on the AI SDK Elements "Attachments"
 * inline variant: an image thumbnail or file icon, the name, and a remove
 * button. Styled to the app's tokens.
 */
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

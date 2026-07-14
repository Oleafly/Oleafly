// The same view a resume parser or screen reader gets: plain text extracted
// from the compiled PDF in reading order.
import { memo } from "react";

export const ReaderView = memo(function ReaderView({ pages }: { pages: string[] }) {
  return (
    <div className="rounded-md border border-sidebar-border bg-black/[0.03] dark:bg-background">
      {pages.map((text, i) => (
        <div key={i} className="border-b border-sidebar-border last:border-b-0">
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Page {i + 1}</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-2.5 pb-2 font-mono text-[11px] leading-relaxed text-foreground/90">
            {text || "(no selectable text on this page)"}
          </pre>
        </div>
      ))}
    </div>
  );
});

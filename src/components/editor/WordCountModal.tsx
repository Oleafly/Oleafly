import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore, useActiveContent } from "@/store/files";
import { countWords } from "@/lib/wordcount";
import { getEditorView } from "@/components/editor/cm/controller";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

/** Text of the editor's primary selection, or null when it is empty. */
export function activeSelectionText(): string | null {
  const view = getEditorView();
  if (!view) return null;
  const sel = view.state.selection.main;
  if (sel.empty) return null;
  return view.state.sliceDoc(sel.from, sel.to);
}

export function WordCountModal() {
  const open = useSettingsStore((s) => s.wordCountOpen);
  const setOpen = useSettingsStore((s) => s.setWordCountOpen);
  const content = useActiveContent();
  const activePath = useFilesStore((s) => s.activePath);

  const stats = useMemo(() => (open ? countWords(content) : null), [open, content]);
  const selectionWords = useMemo(() => {
    if (!open) return null;
    const selected = activeSelectionText();
    return selected === null ? null : countWords(selected).words;
  }, [open]);
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, () => setOpen(false));

  if (!open || !stats) return null;

  const rows: [string, number][] = [
    ["Words", stats.words],
    ["Characters", stats.characters],
    ["Lines", stats.lines],
  ];
  if (selectionWords !== null) rows.push(["Selection", selectionWords]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <button type="button" aria-label="Close word count" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="word-count-title"
        className="relative w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
      >
        <h2 id="word-count-title" className="mb-1 text-base font-semibold">Word count</h2>
        <p className="mb-4 truncate text-xs text-muted-foreground">
          {activePath ?? "no file"}
        </p>
        <div className="divide-y divide-border">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="font-mono text-sm tabular-nums">
                {value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button data-modal-initial-focus size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Search, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/store/settings";
import { shortcut } from "@/lib/utils";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { objectKey } from "@/lib/react-key";

// Leaves rows that already spell out both conventions (e.g. "Ctrl-Space") untouched.
const keyLabel = (keys: string) => (keys.includes("Ctrl") ? keys : shortcut(keys));

function ShortcutKeys({ keys }: { keys: string }) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  let tokens: string[];
  if (keys === "⌘/Ctrl-click") {
    tokens = [mac ? "⌘" : "Ctrl", "Click"];
  } else if (keys.includes("Toolbar →")) {
    tokens = keys.split(" → ");
  } else {
    const normalized = keyLabel(keys);
    const [combination, command] = normalized.split(" → ");
    if (combination.includes("+")) {
      tokens = combination.split("+");
    } else if (combination.includes("-")) {
      tokens = combination.split("-");
    } else {
      tokens = [];
      let remaining = combination;
      for (const modifier of ["⌘", "⇧", "⌥"]) {
        if (!remaining.startsWith(modifier)) continue;
        tokens.push(modifier === "⇧" ? "Shift" : modifier);
        remaining = remaining.slice(modifier.length);
      }
      if (remaining) tokens.push(remaining === "↵" ? "Enter" : remaining);
    }
    if (command) tokens.push("→", command);
  }

  return (
    <KbdGroup className="shrink-0">
      {tokens.map((token) => (
        <Kbd
          key={token}
          className="h-7 min-w-7 rounded-md border bg-background px-2 text-sm text-foreground"
        >
          {token}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

const SHORTCUTS: { category: string; keys: string; desc: string }[] = [
  { category: "Compile", keys: "⌘↵", desc: "Recompile" },
  { category: "Compile", keys: "⌘K → Recompile", desc: "Via command palette" },
  { category: "Editor", keys: "⌘L", desc: "Ask AI to edit selection" },
  { category: "Editor", keys: "⌘B", desc: "Bold (\\textbf)" },
  { category: "Editor", keys: "⌘I", desc: "Italic (\\textit)" },
  { category: "Editor", keys: "⌘F", desc: "Find & replace" },
  { category: "Editor", keys: "⌘Z", desc: "Undo" },
  { category: "Editor", keys: "⌘⇧Z", desc: "Redo" },
  { category: "Editor", keys: "Ctrl-Space", desc: "Trigger autocomplete" },
  { category: "Editor", keys: "/", desc: "Slash-command insert menu" },
  { category: "Editor", keys: "Tab", desc: "Indent / accept autocomplete" },
  { category: "Code intelligence", keys: "F12", desc: "Go to definition" },
  { category: "Code intelligence", keys: "⌘/Ctrl-click", desc: "Go to definition" },
  { category: "Code intelligence", keys: "⇧F12", desc: "Find references" },
  { category: "Code intelligence", keys: "F2", desc: "Rename symbol (project-wide)" },
  { category: "Navigation", keys: "⌘K", desc: "Command palette" },
  { category: "Navigation", keys: "⌘⇧F", desc: "Search all documents" },
  { category: "Navigation", keys: "⌘⇧J", desc: "Go to PDF (SyncTeX forward)" },
  { category: "PDF", keys: "⌘/Ctrl-click", desc: "Jump to source from PDF" },
  { category: "Git", keys: "Toolbar → Git icon", desc: "Commit & push" },
  { category: "Settings", keys: "Toolbar → ⚙", desc: "Open settings" },
];

export function HotkeysModal() {
  const open = useSettingsStore((s) => s.hotkeysOpen);
  const setOpen = useSettingsStore((s) => s.setHotkeysOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const [q, setQ] = useState("");
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, () => setOpen(false));

  const filtered = useMemo(
    () =>
      SHORTCUTS.filter(
        (s) =>
          s.desc.toLowerCase().includes(q.toLowerCase()) ||
          s.category.toLowerCase().includes(q.toLowerCase()) ||
          s.keys.toLowerCase().includes(q.toLowerCase())
      ),
    [q]
  );

  const categories = useMemo(
    () => Array.from(new Set(filtered.map((s) => s.category))),
    [filtered]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <button type="button" aria-label="Close keyboard shortcuts" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="hotkeys-title"
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-sidebar text-sidebar-foreground shadow-2xl"
      >
        <div className="flex min-h-14 items-center justify-between border-b border-sidebar-border px-5 py-3">
          <h2 id="hotkeys-title" className="text-sm font-semibold">Keyboard Shortcuts</h2>
          <div className="flex items-center gap-1">
            <Tooltip label="Customize keyboard shortcuts">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  setOpen(false);
                  setSettingsInitialSection("shortcuts");
                  requestAnimationFrame(() => setSettingsOpen(true));
                }}
                aria-label="Open keyboard shortcut settings"
              >
                <Wrench />
              </Button>
            </Tooltip>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setOpen(false)} aria-label="Close keyboard shortcuts">
              <X />
            </Button>
          </div>
        </div>
        <div className="border-b border-sidebar-border p-3">
          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 transition-colors focus-within:ring-1 focus-within:ring-ring">
            <Search className="size-4 text-muted-foreground" />
            <Input
              data-modal-initial-focus
              aria-label="Search shortcuts"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search shortcuts…"
              className="h-9 w-full rounded-none border-0 bg-transparent px-0 text-sm shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {categories.map((cat, ci) => (
            <div key={cat} className={ci > 0 ? "mb-4 border-t border-sidebar-border pt-4" : "mb-4"}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {cat}
              </div>
              {filtered
                .filter((s) => s.category === cat)
                .map((s) => (
                  <div key={objectKey(s, "shortcut")} className="flex items-center justify-between py-1.5">
                    <span className="text-sm">{s.desc}</span>
                    <ShortcutKeys keys={s.keys} />
                  </div>
                ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No shortcuts found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  bindingFromEvent,
  reservedShortcutLabel,
  sameShortcutBinding,
  SHORTCUT_DEFINITIONS,
  shortcutLabel,
  type ShortcutBinding,
  type ShortcutId,
  useShortcutStore,
} from "@/store/shortcuts";

function ShortcutKeys({ binding }: { binding: ShortcutBinding }) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const keys = [
    binding.mod ? (mac ? "⌘" : "Ctrl") : null,
    binding.shift ? "Shift" : null,
    binding.alt ? (mac ? "⌥" : "Alt") : null,
    binding.key === " " ? "Space" : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key,
  ].filter((key): key is string => Boolean(key));

  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd
          key={key}
          className="h-8 min-w-8 rounded-md border px-2 text-sm text-foreground"
        >
          {key}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

const BUILT_IN_SHORTCUTS = [
  { category: "Editor", label: "Ask AI to edit selection", keys: ["Mod", "L"] },
  { category: "Editor", label: "Bold", keys: ["Mod", "B"] },
  { category: "Editor", label: "Italic", keys: ["Mod", "I"] },
  { category: "Editor", label: "Find and replace", keys: ["Mod", "F"] },
  { category: "Editor", label: "Undo", keys: ["Mod", "Z"] },
  { category: "Editor", label: "Redo", keys: ["Mod", "Shift", "Z"] },
  { category: "Editor", label: "Trigger autocomplete", keys: ["Ctrl", "Space"] },
  { category: "Editor", label: "Slash-command insert menu", keys: ["/"] },
  { category: "Editor", label: "Indent or accept autocomplete", keys: ["Tab"] },
  { category: "Code intelligence", label: "Go to definition", keys: ["F12"] },
  { category: "Code intelligence", label: "Go to definition with pointer", keys: ["Mod", "Click"] },
  { category: "Code intelligence", label: "Find references", keys: ["Shift", "F12"] },
  { category: "Code intelligence", label: "Rename symbol project-wide", keys: ["F2"] },
  { category: "PDF", label: "Jump to source from PDF", keys: ["Mod", "Click"] },
] as const;

function BuiltInKeys({ keys }: { keys: readonly string[] }) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd
          key={key}
          className="h-8 min-w-8 rounded-md border px-2 text-sm text-foreground"
        >
          {key === "Mod" ? (mac ? "⌘" : "Ctrl") : key}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

function builtInBinding(keys: readonly string[]): ShortcutBinding | null {
  if (!keys.includes("Mod") && !keys.includes("Ctrl")) return null;
  const key = keys.find((value) => !["Mod", "Ctrl", "Shift", "Alt"].includes(value));
  if (!key || key === "Click") return null;
  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    mod: true,
    shift: keys.includes("Shift"),
    alt: keys.includes("Alt"),
  };
}

export function ShortcutsSection() {
  const bindings = useShortcutStore((state) => state.bindings);
  const setBinding = useShortcutStore((state) => state.setBinding);
  const resetBinding = useShortcutStore((state) => state.resetBinding);
  const resetAll = useShortcutStore((state) => state.resetAll);
  const [editing, setEditing] = useState<ShortcutId | null>(null);
  const [error, setError] = useState("");
  const captureRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editing) return;
    captureRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (captureRef.current?.contains(event.target as Node)) return;
      setEditing(null);
      setError("");
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [editing]);

  const capture = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setEditing(null);
      setError("");
      return;
    }
    const next = bindingFromEvent(event.nativeEvent);
    if (!next) return;
    const reserved = reservedShortcutLabel(next);
    if (reserved) {
      setError(`${reserved} is reserved by the operating system.`);
      return;
    }
    const appConflict = SHORTCUT_DEFINITIONS.find(
      ({ id }) => id !== editing && sameShortcutBinding(bindings[id], next),
    );
    const builtInConflict = BUILT_IN_SHORTCUTS.find(({ keys }) => {
      const binding = builtInBinding(keys);
      return binding ? sameShortcutBinding(binding, next) : false;
    });
    const conflictLabel = appConflict?.label ?? builtInConflict?.label;
    if (conflictLabel) {
      setError(`Already assigned to ${conflictLabel}.`);
      return;
    }
    setBinding(editing, next);
    setEditing(null);
    setError("");
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Customize application shortcuts and review editor-native key combinations.
        </p>
      </div>
      <section className="flex flex-col gap-2" aria-labelledby="application-shortcuts">
        <h3 id="application-shortcuts" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Application shortcuts
        </h3>
        {SHORTCUT_DEFINITIONS.map((definition) => {
          const active = editing === definition.id;
          return (
            <div
              key={definition.id}
              className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{definition.label}</p>
                <p className="text-xs text-muted-foreground">{definition.description}</p>
                {active && error && <p className="mt-1 text-xs text-destructive">{error}</p>}
                {active && !error && (
                  <p className="mt-1 text-xs text-primary">Press the new key combination</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  ref={active ? captureRef : undefined}
                  onKeyDown={active ? capture : undefined}
                  aria-label={
                    active
                      ? `Recording ${definition.label}. Press a shortcut.`
                      : `Edit ${definition.label}, currently ${shortcutLabel(bindings[definition.id])}`
                  }
                  onClick={() => {
                    setEditing(definition.id);
                    setError("");
                  }}
                  className="rounded-md outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {active ? (
                    <Kbd className="h-8 min-w-32 rounded-md border border-primary bg-primary/10 px-3 text-sm text-primary">
                      Recording
                    </Kbd>
                  ) : (
                    <ShortcutKeys binding={bindings[definition.id]} />
                  )}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Reset ${definition.label}`}
                  onClick={() => resetBinding(definition.id)}
                >
                  <RotateCcw data-icon="inline-start" />
                </Button>
              </div>
            </div>
          );
        })}
      </section>
      {[...new Set(BUILT_IN_SHORTCUTS.map(({ category }) => category))].map((category) => (
        <section key={category} className="flex flex-col gap-2" aria-labelledby={`shortcut-category-${category}`}>
          <div>
            <h3
              id={`shortcut-category-${category}`}
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {category}
            </h3>
            <p className="text-xs text-muted-foreground">Managed by the editor</p>
          </div>
          {BUILT_IN_SHORTCUTS.filter((shortcut) => shortcut.category === category).map(
            (shortcut) => (
              <div
                key={shortcut.label}
                className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
              >
                <p className="text-sm font-medium">{shortcut.label}</p>
                <BuiltInKeys keys={shortcut.keys} />
              </div>
            ),
          )}
        </section>
      ))}
      <div className="flex justify-end border-t pt-4">
        <Button variant="secondary" size="sm" onClick={resetAll}>
          <RotateCcw className="size-3.5" />
          Reset all shortcuts
        </Button>
      </div>
    </div>
  );
}

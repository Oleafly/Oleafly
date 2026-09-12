import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResetToDefaults } from "@/components/settings/ResetToDefaults";
import {
  bindingFromEvent,
  reservedShortcutAction,
  sameShortcutBinding,
  SHORTCUT_DEFINITIONS,
  shortcutLabel,
  type ShortcutBinding,
  type ShortcutId,
  useShortcutStore,
} from "@/store/shortcuts";

function ShortcutKeys({ binding }: Readonly<{ binding: ShortcutBinding }>) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const modSymbol = mac ? "⌘" : "Ctrl";
  const altSymbol = mac ? "⌥" : "Alt";
  const namedKey = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  const keys = [...new Set([
    binding.mod ? modSymbol : null,
    binding.ctrl && (mac || !binding.mod) ? "Ctrl" : null,
    binding.shift ? "Shift" : null,
    binding.alt ? altSymbol : null,
    binding.key === " " ? "Space" : namedKey,
  ].filter((key): key is string => Boolean(key)))];

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

type BuiltInCategory = "editor" | "codeIntelligence" | "pdf";

type BuiltInShortcutId =
  | "askAiEditSelection"
  | "bold"
  | "italic"
  | "findAndReplace"
  | "undo"
  | "redo"
  | "triggerAutocomplete"
  | "slashCommandMenu"
  | "indentOrAcceptAutocomplete"
  | "goToDefinition"
  | "goToDefinitionWithPointer"
  | "findReferences"
  | "renameSymbol"
  | "jumpToSourceFromPdf";

interface BuiltInShortcut {
  id: BuiltInShortcutId;
  category: BuiltInCategory;
  keys: readonly string[];
}

const BUILT_IN_SHORTCUTS: readonly BuiltInShortcut[] = [
  { id: "askAiEditSelection", category: "editor", keys: ["Mod", "L"] },
  { id: "bold", category: "editor", keys: ["Mod", "B"] },
  { id: "italic", category: "editor", keys: ["Mod", "I"] },
  { id: "findAndReplace", category: "editor", keys: ["Mod", "F"] },
  { id: "undo", category: "editor", keys: ["Mod", "Z"] },
  { id: "redo", category: "editor", keys: ["Mod", "Shift", "Z"] },
  { id: "triggerAutocomplete", category: "editor", keys: ["Ctrl", "Space"] },
  { id: "slashCommandMenu", category: "editor", keys: ["/"] },
  { id: "indentOrAcceptAutocomplete", category: "editor", keys: ["Tab"] },
  { id: "goToDefinition", category: "codeIntelligence", keys: ["F12"] },
  { id: "goToDefinitionWithPointer", category: "codeIntelligence", keys: ["Mod", "Click"] },
  { id: "findReferences", category: "codeIntelligence", keys: ["Shift", "F12"] },
  { id: "renameSymbol", category: "codeIntelligence", keys: ["F2"] },
  { id: "jumpToSourceFromPdf", category: "pdf", keys: ["Mod", "Click"] },
];

const CATEGORY_TEST_IDS: Record<BuiltInCategory, string> = {
  editor: "shortcuts-tab-editor",
  codeIntelligence: "shortcuts-tab-code-intelligence",
  pdf: "shortcuts-tab-pdf",
};

function BuiltInKeys({ keys }: Readonly<{ keys: readonly string[] }>) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const modSymbol = mac ? "⌘" : "Ctrl";
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd
          key={key}
          className="h-8 min-w-8 rounded-md border px-2 text-sm text-foreground"
        >
          {key === "Mod" ? modSymbol : key}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

function builtInBinding(keys: readonly string[]): ShortcutBinding | null {
  if (!keys.includes("Mod") && !keys.includes("Ctrl")) return null;
  const key = keys.find((value) => !["Mod", "Ctrl", "Shift", "Alt"].includes(value));
  if (!key || key === "Click") return null;
  const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
  return {
    key: key === "Space" ? " " : normalizedKey,
    mod: keys.includes("Mod"),
    ctrl: keys.includes("Ctrl"),
    shift: keys.includes("Shift"),
    alt: keys.includes("Alt"),
  };
}

export function ShortcutsSection() {
  const { t } = useTranslation(["common", "settings"]);
  const bindings = useShortcutStore((state) => state.bindings);
  const setBinding = useShortcutStore((state) => state.setBinding);
  const resetBinding = useShortcutStore((state) => state.resetBinding);
  const resetAll = useShortcutStore((state) => state.resetAll);
  const [editing, setEditing] = useState<ShortcutId | null>(null);
  const [error, setError] = useState("");
  const captureRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editing) return;
    captureRef.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (captureRef.current?.contains(event.target as Node)) return;
      setEditing(null);
      setError("");
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [editing]);

  const actionLabel = (id: ShortcutId) => t(($) => $.settings.shortcuts.actions[id].label);

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
    const reserved = reservedShortcutAction(next);
    if (reserved) {
      setError(
        t(($) => $.settings.shortcuts.error.reserved, {
          shortcut: t(($) => $.settings.shortcuts.reserved[reserved]),
        }),
      );
      return;
    }
    const appConflict = SHORTCUT_DEFINITIONS.find(
      ({ id }) => id !== editing && sameShortcutBinding(bindings[id], next),
    );
    const builtInConflict = BUILT_IN_SHORTCUTS.find(({ keys }) => {
      const binding = builtInBinding(keys);
      return binding ? sameShortcutBinding(binding, next) : false;
    });
    let conflictLabel = "";
    if (appConflict) {
      conflictLabel = actionLabel(appConflict.id);
    } else if (builtInConflict) {
      const id = builtInConflict.id;
      conflictLabel = t(($) => $.settings.shortcuts.builtIn.labels[id]);
    }
    if (conflictLabel) {
      setError(t(($) => $.settings.shortcuts.error.conflict, { action: conflictLabel }));
      return;
    }
    setBinding(editing, next);
    setEditing(null);
    setError("");
  };

  const categories = [...new Set(BUILT_IN_SHORTCUTS.map(({ category }) => category))];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          {t(($) => $.settings.shortcuts.intro)}
        </p>
      </div>
      <Tabs defaultValue="application" className="space-y-4">
        <TabsList>
          <TabsTrigger value="application" data-testid="shortcuts-tab-application">
            {t(($) => $.settings.shortcuts.tabs.application)}
          </TabsTrigger>
          {categories.map((category) => (
            <TabsTrigger
              key={category}
              value={category}
              data-testid={CATEGORY_TEST_IDS[category]}
            >
              {t(($) => $.settings.shortcuts.categories[category])}
            </TabsTrigger>
          ))}
        </TabsList>
      <TabsContent value="application">
      <section className="flex flex-col gap-2" aria-labelledby="application-shortcuts">
        <h3 id="application-shortcuts" className="sr-only">
          {t(($) => $.settings.shortcuts.application.heading)}
        </h3>
        {SHORTCUT_DEFINITIONS.map((definition) => {
          const active = editing === definition.id;
          const label = actionLabel(definition.id);
          return (
            <div
              key={definition.id}
              className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">
                  {t(($) => $.settings.shortcuts.actions[definition.id].description)}
                </p>
                {active && error && <p className="mt-1 text-xs text-destructive">{error}</p>}
                {active && !error && (
                  <p className="mt-1 text-xs text-primary">
                    {t(($) => $.settings.shortcuts.application.prompt)}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  ref={active ? captureRef : undefined}
                  onKeyDown={active ? capture : undefined}
                  aria-label={
                    active
                      ? t(($) => $.settings.shortcuts.application.recordAriaLabel, {
                          action: label,
                        })
                      : t(($) => $.settings.shortcuts.application.editAriaLabel, {
                          action: label,
                          shortcut: shortcutLabel(bindings[definition.id]),
                        })
                  }
                  onClick={() => {
                    setEditing(definition.id);
                    setError("");
                  }}
                  className="rounded-md outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {active ? (
                    <Kbd className="h-8 min-w-32 rounded-md border border-primary bg-primary/10 px-3 text-sm text-primary">
                      {t(($) => $.settings.shortcuts.application.recording)}
                    </Kbd>
                  ) : (
                    <ShortcutKeys binding={bindings[definition.id]} />
                  )}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t(($) => $.settings.shortcuts.application.resetAriaLabel, {
                    action: label,
                  })}
                  onClick={() => resetBinding(definition.id)}
                >
                  <RotateCcw data-icon="inline-start" />
                </Button>
              </div>
            </div>
          );
        })}
      </section>
      </TabsContent>
      {categories.map((category) => (
        <TabsContent key={category} value={category}>
        <section className="flex flex-col gap-2" aria-labelledby={`shortcut-category-${category}`}>
          <div>
            <h3
              id={`shortcut-category-${category}`}
              className="sr-only"
            >
              {t(($) => $.settings.shortcuts.categories[category])}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(($) => $.settings.shortcuts.builtIn.managed)}
            </p>
          </div>
          {BUILT_IN_SHORTCUTS.filter((shortcut) => shortcut.category === category).map(
            (shortcut) => (
              <div
                key={shortcut.id}
                className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
              >
                <p className="text-sm font-medium">
                  {t(($) => $.settings.shortcuts.builtIn.labels[shortcut.id])}
                </p>
                <BuiltInKeys keys={shortcut.keys} />
              </div>
            ),
          )}
        </section>
        </TabsContent>
      ))}
      </Tabs>
      <ResetToDefaults
        sectionName={t(($) => $.settings.shortcuts.reset.sectionName)}
        onReset={resetAll}
      />
    </div>
  );
}

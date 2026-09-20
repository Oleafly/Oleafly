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
import {
  EDITOR_KEY_DEFINITIONS,
  editorKeyFromEvent,
  editorKeyTokens,
  sameEditorKey,
  useEditorKeymapStore,
  type EditorKeyId,
} from "@/store/editor-keymap";

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

  return <KeyTokens tokens={keys} />;
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
  return <KeyTokens tokens={keys.map((key) => (key === "Mod" ? modSymbol : key))} />;
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

function KeyTokens({ tokens }: Readonly<{ tokens: readonly string[] }>) {
  return (
    <KbdGroup>
      {tokens.map((token) => (
        <Kbd
          key={token}
          className="h-8 min-w-8 rounded-md border px-2 text-sm text-foreground"
        >
          {token}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

function appShortcutKey(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.mod) parts.push("Mod");
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  parts.push(binding.key === " " ? "Space" : binding.key);
  return parts.join("-");
}

function useDismissOnPointerDown(
  active: boolean,
  ref: React.RefObject<HTMLButtonElement | null>,
  dismiss: () => void,
) {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    if (!active) return;
    ref.current?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      dismissRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [active, ref]);
}

function EditorKeyRows() {
  const { t } = useTranslation(["common", "settings"]);
  const keys = useEditorKeymapStore((state) => state.keys);
  const setKey = useEditorKeymapStore((state) => state.setKey);
  const resetKey = useEditorKeymapStore((state) => state.resetKey);
  const appBindings = useShortcutStore((state) => state.bindings);
  const [editing, setEditing] = useState<EditorKeyId | null>(null);
  const [error, setError] = useState("");
  const captureRef = useRef<HTMLButtonElement>(null);

  useDismissOnPointerDown(editing !== null, captureRef, () => {
    setEditing(null);
    setError("");
  });

  const actionLabel = (id: EditorKeyId) =>
    t(($) => $.settings.shortcuts.editorKeys.labels[id]);

  const conflictLabel = (candidate: string, current: EditorKeyId): string => {
    const app = SHORTCUT_DEFINITIONS.find(({ id }) =>
      sameEditorKey(appShortcutKey(appBindings[id]), candidate),
    );
    if (app) return t(($) => $.settings.shortcuts.actions[app.id].label);
    const editor = EDITOR_KEY_DEFINITIONS.find(
      ({ id }) => id !== current && sameEditorKey(keys[id], candidate),
    );
    return editor ? actionLabel(editor.id) : "";
  };

  const capture = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setEditing(null);
      setError("");
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setKey(editing, "");
      setEditing(null);
      setError("");
      return;
    }
    const next = editorKeyFromEvent(event.nativeEvent);
    const asBinding = bindingFromEvent(event.nativeEvent);
    if (!next) return;
    const reserved = asBinding ? reservedShortcutAction(asBinding) : null;
    if (reserved) {
      setError(
        t(($) => $.settings.shortcuts.error.reserved, {
          shortcut: t(($) => $.settings.shortcuts.reserved[reserved]),
        }),
      );
      return;
    }
    const conflict = conflictLabel(next, editing);
    if (conflict) {
      setError(t(($) => $.settings.shortcuts.error.conflict, { action: conflict }));
      return;
    }
    setKey(editing, next);
    setEditing(null);
    setError("");
  };

  return (
    <section className="flex flex-col gap-2" aria-labelledby="editor-keys">
      <div>
        <h3 id="editor-keys" className="sr-only">
          {t(($) => $.settings.shortcuts.editorKeys.heading)}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.shortcuts.editorKeys.intro)}
        </p>
      </div>
      {EDITOR_KEY_DEFINITIONS.map((definition) => {
        const active = editing === definition.id;
        const label = actionLabel(definition.id);
        const current = keys[definition.id];
        const tokens = editorKeyTokens(current);
        return (
          <div
            key={definition.id}
            data-testid={`editor-key-row-${definition.id}`}
            className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              {active && error && <p className="mt-1 text-xs text-destructive">{error}</p>}
              {active && !error && (
                <p className="mt-1 text-xs text-primary">
                  {`${t(($) => $.settings.shortcuts.application.prompt)} ${t(
                    ($) => $.settings.shortcuts.editorKeys.clearHint,
                  )}`}
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
                        shortcut:
                          tokens.length > 0
                            ? tokens.join(" ")
                            : t(($) => $.settings.shortcuts.editorKeys.unbound),
                      })
                }
                onClick={() => {
                  setEditing(definition.id);
                  setError("");
                }}
                className="rounded-md outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {active && (
                  <Kbd className="h-8 min-w-32 rounded-md border border-primary bg-primary/10 px-3 text-sm text-primary">
                    {t(($) => $.settings.shortcuts.application.recording)}
                  </Kbd>
                )}
                {!active && tokens.length > 0 && <KeyTokens tokens={tokens} />}
                {!active && tokens.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t(($) => $.settings.shortcuts.editorKeys.unbound)}
                  </span>
                )}
              </button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t(($) => $.settings.shortcuts.application.resetAriaLabel, {
                  action: label,
                })}
                onClick={() => resetKey(definition.id)}
              >
                <RotateCcw data-icon="inline-start" />
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function ShortcutsSection() {
  const { t } = useTranslation(["common", "settings"]);
  const bindings = useShortcutStore((state) => state.bindings);
  const setBinding = useShortcutStore((state) => state.setBinding);
  const resetBinding = useShortcutStore((state) => state.resetBinding);
  const resetAll = useShortcutStore((state) => state.resetAll);
  const resetEditorKeys = useEditorKeymapStore((state) => state.resetAll);
  const [editing, setEditing] = useState<ShortcutId | null>(null);
  const [error, setError] = useState("");
  const captureRef = useRef<HTMLButtonElement>(null);

  useDismissOnPointerDown(editing !== null, captureRef, () => {
    setEditing(null);
    setError("");
  });

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
          {category === "editor" && <EditorKeyRows />}
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
        onReset={() => {
          resetAll();
          resetEditorKeys();
        }}
      />
    </div>
  );
}

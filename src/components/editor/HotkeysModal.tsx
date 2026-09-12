import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/store/settings";
import { i18n } from "@/i18n";
import { shortcut } from "@/lib/utils";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

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

interface ShortcutRow {
  id: string;
  category: () => string;
  keys: string;
  desc: () => string;
}

const SHORTCUTS: ShortcutRow[] = [
  {
    id: "recompile",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.compile),
    keys: "⌘↵",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.recompile),
  },
  {
    id: "recompile-palette",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.compile),
    keys: "⌘K → Recompile",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.viaCommandPalette),
  },
  {
    id: "inline-ai",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.editor),
    keys: "⌘L",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.askAiEditSelection),
  },
  {
    id: "bold",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.editor),
    keys: "⌘B",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.bold),
  },
  {
    id: "italic",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.editor),
    keys: "⌘I",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.italic),
  },
  {
    id: "find-replace",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.editor),
    keys: "⌘F",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.findAndReplace),
  },
  {
    id: "undo",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.editor),
    keys: "⌘Z",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.undo),
  },
  {
    id: "redo",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.editor),
    keys: "⌘⇧Z",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.redo),
  },
  {
    id: "autocomplete",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.editor),
    keys: "Ctrl-Space",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.triggerAutocomplete),
  },
  {
    id: "slash-menu",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.editor),
    keys: "/",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.slashCommandMenu),
  },
  {
    id: "indent",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.editor),
    keys: "Tab",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.indentOrAccept),
  },
  {
    id: "definition-f12",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.codeIntelligence),
    keys: "F12",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.goToDefinition),
  },
  {
    id: "definition-click",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.codeIntelligence),
    keys: "⌘/Ctrl-click",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.goToDefinition),
  },
  {
    id: "references",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.codeIntelligence),
    keys: "⇧F12",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.findReferences),
  },
  {
    id: "rename",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.codeIntelligence),
    keys: "F2",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.renameSymbol),
  },
  {
    id: "command-palette",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.navigation),
    keys: "⌘K",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.commandPalette),
  },
  {
    id: "search-documents",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.navigation),
    keys: "⌘⇧F",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.searchAllDocuments),
  },
  {
    id: "synctex-forward",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.navigation),
    keys: "⌘⇧J",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.goToPdf),
  },
  {
    id: "synctex-inverse",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.pdf),
    keys: "⌘/Ctrl-click",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.jumpToSource),
  },
  {
    id: "commit-push",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.git),
    keys: "Toolbar → Git icon",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.commitAndPush),
  },
  {
    id: "open-settings",
    category: () => i18n.t(($) => $.editor.hotkeys.categories.settings),
    keys: "Toolbar → ⚙",
    desc: () => i18n.t(($) => $.editor.hotkeys.actions.openSettings),
  },
];

export function HotkeysModal() {
  const { t } = useTranslation(["common", "editor"]);
  const open = useSettingsStore((s) => s.hotkeysOpen);
  const setOpen = useSettingsStore((s) => s.setHotkeysOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const [q, setQ] = useState("");
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, () => setOpen(false));

  // biome-ignore lint/correctness/useExhaustiveDependencies: t re-runs the filter when the interface language changes.
  const filtered = useMemo(
    () =>
      SHORTCUTS.filter(
        (s) =>
          s.desc().toLowerCase().includes(q.toLowerCase()) ||
          s.category().toLowerCase().includes(q.toLowerCase()) ||
          s.keys.toLowerCase().includes(q.toLowerCase())
      ),
    [q, t]
  );

  const categories = useMemo(
    () => Array.from(new Set(filtered.map((s) => s.category()))),
    [filtered]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label={t(($) => $.editor.hotkeys.close)}
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="hotkeys-title"
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-sidebar text-sidebar-foreground shadow-2xl"
      >
        <div className="flex min-h-14 items-center justify-between border-b border-sidebar-border px-5 py-3">
          <h2 id="hotkeys-title" className="text-sm font-semibold">
            {t(($) => $.editor.hotkeys.title)}
          </h2>
          <div className="flex items-center gap-1">
            <Tooltip label={t(($) => $.editor.hotkeys.customize)}>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  setOpen(false);
                  setSettingsInitialSection("shortcuts");
                  requestAnimationFrame(() => setSettingsOpen(true));
                }}
                aria-label={t(($) => $.editor.hotkeys.openSettings)}
              >
                <Wrench />
              </Button>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setOpen(false)}
              aria-label={t(($) => $.editor.hotkeys.close)}
            >
              <X />
            </Button>
          </div>
        </div>
        <div className="border-b border-sidebar-border p-3">
          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
            <Search className="size-4 text-muted-foreground" />
            <Input
              data-modal-initial-focus
              aria-label={t(($) => $.editor.hotkeys.searchLabel)}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t(($) => $.editor.hotkeys.searchPlaceholder)}
              className="h-10 w-full rounded-none border-0 bg-transparent px-0 text-sm shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
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
                .filter((s) => s.category() === cat)
                .map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-1.5">
                    <span className="text-sm">{s.desc()}</span>
                    <ShortcutKeys keys={s.keys} />
                  </div>
                ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t(($) => $.editor.hotkeys.empty)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

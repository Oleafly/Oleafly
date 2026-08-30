import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Command, defaultFilter } from "cmdk";
import { commandsFor, commandLabel, type AppContext } from "@oleafly/registry";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { commandAliasSearchText } from "@/lib/command-search";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { useOccludeNativeWebview } from "@/lib/native-webview-occlusion";

export function CommandPalette() {
  const open = useSettingsStore((s) => s.paletteOpen);
  useOccludeNativeWebview(open);
  const setPaletteOpen = useSettingsStore((s) => s.setPaletteOpen);
  const latexTools = useSettingsStore((s) => s.latexTools);
  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState("");
  const projectId = useFilesStore((s) => s.projectId);
  const projectKind = useFilesStore((s) => s.projectKind);
  const engine = useFilesStore((s) => s.engine);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const activePath = useFilesStore((s) => s.activePath);
  const { theme } = useTheme();

  const close = () => setPaletteOpen(false);
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      if (matchesShortcut(e, useShortcutStore.getState().bindings.commandPalette)) {
        e.preventDefault();
        setPaletteOpen(!useSettingsStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!E2E_HOOKS || !open) return;
    const setE2eQuery = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string") {
        return;
      }
      setQuery(event.detail);
    };
    window.addEventListener("oleafly:e2e-command-query", setE2eQuery);
    return () =>
      window.removeEventListener("oleafly:e2e-command-query", setE2eQuery);
  }, [open]);

  const ctx = useMemo<AppContext>(
    () => ({
      projectId,
      projectKind,
      theme,
      documentEngineId: engine.id,
      documentEngineLoaded: engineLoaded,
      activeDocumentPath: activePath,
      latexToolsEnabled: latexTools,
    }),
    [
      activePath,
      engine.id,
      engineLoaded,
      latexTools,
      projectId,
      projectKind,
      theme,
    ],
  );

  // Map preserves insertion order, so groups render in registration order.
  const groups = useMemo(() => {
    const cmds = commandsFor("palette", ctx);
    const search = query.trim();
    const visibleCommands = search
      ? cmds
          .map((command) => {
            const label = commandLabel(command, ctx);
            const searchValue =
              `${label} ${command.keywords ?? ""} ${commandAliasSearchText(command.slash)}`;
            return {
              command,
              score: defaultFilter(searchValue, search),
            };
          })
          .filter(({ score }) => score > 0)
          .sort((left, right) => right.score - left.score)
          .map(({ command }) => command)
      : cmds;
    const byGroup = new Map<string, typeof cmds>();
    for (const c of visibleCommands) {
      const g = c.group ?? "Commands";
      const list = byGroup.get(g);
      if (list) list.push(c);
      else byGroup.set(g, [c]);
    }
    return [...byGroup.entries()];
  }, [ctx, query]);

  const bestMatchValue = useMemo(() => {
    const command = groups[0]?.[1][0];
    if (!command) return "";
    return `${commandLabel(command, ctx)} ${command.keywords ?? ""} ${commandAliasSearchText(command.slash)}`;
  }, [ctx, groups]);

  useEffect(() => {
    setSelectedValue(bestMatchValue);
  }, [bestMatchValue]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setPaletteOpen}
      label="Command Palette"
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
      overlayClassName="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm"
      className={cn("fixed left-1/2 top-[20%] z-50 w-[min(560px,92vw)] -translate-x-1/2")}
    >
      <div className="overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          autoFocus
          placeholder="Type a command or search…"
          className="flex h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-[min(60vh,360px)] overflow-auto p-1.5">
          <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>

          {groups.map(([heading, cmds]) => (
            <Command.Group
              key={heading}
              heading={heading}
              className="px-1 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {cmds.map((c) => (
                <PaletteItem
                  key={c.id}
                  icon={c.icon?.(ctx)}
                  label={commandLabel(c, ctx)}
                  hint={c.hint}
                  searchValue={`${commandLabel(c, ctx)} ${c.keywords ?? ""} ${commandAliasSearchText(c.slash)}`}
                  onSelect={run(() => c.run(ctx))}
                />
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}

function PaletteItem({
  icon,
  label,
  hint,
  searchValue,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  searchValue: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={searchValue}
      onSelect={onSelect}
      className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
      {hint && (
        <span className="ml-auto text-xs text-muted-foreground">{hint}</span>
      )}
    </Command.Item>
  );
}

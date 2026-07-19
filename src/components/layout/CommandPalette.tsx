import { useEffect, useMemo, type ReactNode } from "react";
import { Command } from "cmdk";
import { commandsFor, commandLabel, type AppContext } from "@openleaf/registry";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";

export function CommandPalette() {
  const open = useSettingsStore((s) => s.paletteOpen);
  const setPaletteOpen = useSettingsStore((s) => s.setPaletteOpen);
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
      if (matchesShortcut(e, useShortcutStore.getState().bindings.commandPalette)) {
        e.preventDefault();
        setPaletteOpen(!useSettingsStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  const ctx = useMemo<AppContext>(
    () => ({
      projectId,
      projectKind,
      theme,
      documentEngineId: engine.id,
      documentEngineLoaded: engineLoaded,
      activeDocumentPath: activePath,
    }),
    [activePath, engine.id, engineLoaded, projectId, projectKind, theme],
  );

  // Map preserves insertion order, so groups render in registration order.
  const groups = useMemo(() => {
    const cmds = commandsFor("palette", ctx);
    const byGroup = new Map<string, typeof cmds>();
    for (const c of cmds) {
      const g = c.group ?? "Commands";
      const list = byGroup.get(g);
      if (list) list.push(c);
      else byGroup.set(g, [c]);
    }
    return [...byGroup.entries()];
  }, [ctx]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setPaletteOpen}
      label="Command Palette"
      className={cn("fixed left-1/2 top-[20%] z-50 w-[min(560px,92vw)] -translate-x-1/2")}
    >
      <div className="overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
        <Command.Input
          autoFocus
          placeholder="Type a command or search…"
          className="flex h-11 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
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
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
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

import { useEffect, type ReactNode } from "react";
import { Command } from "cmdk";
import {
  Bold,
  Command as CommandIcon,
  Crosshair,
  Download,
  Image as ImageIcon,
  Italic,
  List,
  Moon,
  Play,
  Quote,
  Sigma,
  Square,
  Sun,
  Table,
  Tag,
  Zap,
} from "lucide-react";
import { useSettingsStore } from "@/store/settings";
import { useCompileStore } from "@/store/compile";
import { useCitationStore } from "@/store/citation";
import { useTheme } from "@/lib/theme";
import { insertAtCursor, wrapSelection } from "@/components/editor/cm/controller";
import { forwardFromCursor } from "@/features/synctex";
import { exportCurrentPdf } from "@/features/export";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const open = useSettingsStore((s) => s.paletteOpen);
  const setPaletteOpen = useSettingsStore((s) => s.setPaletteOpen);
  const setWordCountOpen = useSettingsStore((s) => s.setWordCountOpen);
  const setHistoryOpen = useSettingsStore((s) => s.setHistoryOpen);
  const spellcheck = useSettingsStore((s) => s.spellcheck);
  const toggleSpellcheck = useSettingsStore((s) => s.toggleSpellcheck);
  const offline = useSettingsStore((s) => s.offline);
  const setOffline = useSettingsStore((s) => s.setOffline);
  const vim = useSettingsStore((s) => s.vim);
  const toggleVim = useSettingsStore((s) => s.toggleVim);
  const recompile = useCompileStore((s) => s.recompile);
  const autoCompile = useCompileStore((s) => s.autoCompile);
  const setAutoCompile = useCompileStore((s) => s.setAutoCompile);
  const { theme, toggleTheme } = useTheme();

  const close = () => setPaletteOpen(false);
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  // Cmd/Ctrl-K toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!useSettingsStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

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

          <Command.Group
            heading="Compile"
            className="px-1 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            <PaletteItem
              icon={<Play className="size-4" />}
              label="Recompile"
              hint="⌘↵"
              onSelect={run(() => void recompile())}
            />
            <PaletteItem
              icon={<Zap className="size-4" />}
              label={autoCompile ? "Disable auto-compile" : "Enable auto-compile"}
              onSelect={run(() => setAutoCompile(!autoCompile))}
            />
            <PaletteItem
              icon={<Crosshair className="size-4" />}
              label="Go to PDF (SyncTeX)"
              hint="⌘⇧J"
              onSelect={run(() => void forwardFromCursor())}
            />
            <PaletteItem
              icon={<Download className="size-4" />}
              label="Export PDF…"
              onSelect={run(() => void exportCurrentPdf())}
            />
          </Command.Group>

          <Command.Group
            heading="Tools"
            className="px-1 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            <PaletteItem
              icon={<Sigma className="size-4" />}
              label="Word count"
              onSelect={run(() => setWordCountOpen(true))}
            />
            <PaletteItem
              icon={<List className="size-4" />}
              label="History"
              onSelect={run(() => setHistoryOpen(true))}
            />
            <PaletteItem
              icon={<Quote className="size-4" />}
              label="Add citation"
              hint="DOI / arXiv / title"
              onSelect={run(() => useCitationStore.getState().setOpen(true))}
            />
          </Command.Group>

          <Command.Group
            heading="Insert"
            className="px-1 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            <PaletteItem
              icon={<Bold className="size-4" />}
              label="Bold"
              hint="⌘B"
              onSelect={run(() => wrapSelection("\\textbf{", "}"))}
            />
            <PaletteItem
              icon={<Italic className="size-4" />}
              label="Italic"
              hint="⌘I"
              onSelect={run(() => wrapSelection("\\textit{", "}"))}
            />
            <PaletteItem
              icon={<Square className="size-4" />}
              label="Section"
              onSelect={run(() => insertAtCursor("\\section{}\n"))}
            />
            <PaletteItem
              icon={<List className="size-4" />}
              label="Bulleted list"
              onSelect={run(() =>
                insertAtCursor("\\begin{itemize}\n  \\item \n\\end{itemize}\n")
              )}
            />
            <PaletteItem
              icon={<ImageIcon className="size-4" />}
              label="Figure"
              onSelect={run(() =>
                insertAtCursor(
                  "\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{}\n  \\caption{}\n\\end{figure}\n"
                )
              )}
            />
            <PaletteItem
              icon={<Table className="size-4" />}
              label="Table"
              onSelect={run(() =>
                insertAtCursor(
                  "\\begin{table}[h]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{ll}\n    & \\\\\n  \\end{tabular}\n\\end{table}\n"
                )
              )}
            />
            <PaletteItem
              icon={<Sigma className="size-4" />}
              label="Equation"
              onSelect={run(() =>
                insertAtCursor("\\begin{equation}\n  \n\\end{equation}\n")
              )}
            />
            <PaletteItem
              icon={<Tag className="size-4" />}
              label="Label"
              onSelect={run(() => insertAtCursor("\\label{}"))}
            />
          </Command.Group>

          <Command.Group
            heading="Settings"
            className="px-1 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            <PaletteItem
              icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onSelect={run(toggleTheme)}
            />
            <PaletteItem
              icon={<CommandIcon className="size-4" />}
              label={vim ? "Disable vim mode" : "Enable vim mode"}
              onSelect={run(toggleVim)}
            />
            <PaletteItem
              icon={<Sigma className="size-4" />}
              label={spellcheck ? "Disable spellcheck" : "Enable spellcheck"}
              onSelect={run(toggleSpellcheck)}
            />
            <PaletteItem
              icon={<Zap className="size-4" />}
              label={offline ? "Online mode (allow package fetch)" : "Offline mode (--only-cached)"}
              onSelect={run(() => setOffline(!offline))}
            />
          </Command.Group>
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

import {
  Bold,
  Command as CommandIcon,
  Crosshair,
  Download,
  FolderPlus,
  Image as ImageIcon,
  Italic,
  List,
  Moon,
  Play,
  Plus,
  Quote,
  Settings,
  Sigma,
  Sparkles,
  Square,
  Sun,
  Table,
  Tag,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { registerCommand, type AppContext } from "@oleafly/registry";
import { useSettingsStore } from "@/store/settings";
import { useCompileStore } from "@/store/compile";
import { useCitationStore } from "@/store/citation";
import { clearBuildCache } from "@/lib/tauri";
import { insertAtCursor, wrapSelection } from "@/components/editor/cm/controller";
import { forwardFromCursor } from "@/features/synctex";
import { exportCurrentPdf } from "@/features/export";
import { useFilesStore } from "@/store/files";
import {
  formattingForEngine,
  pathUsesEngineSource,
  type EngineFormattingAction,
} from "@/lib/document-engine";

const engine = () => useFilesStore.getState().engine;
const engineLoaded = () => useFilesStore.getState().engineLoaded;
const activeUsesEngineSource = () => {
  const files = useFilesStore.getState();
  return pathUsesEngineSource(files.engine, files.activePath);
};
const isLatex = () =>
  engineLoaded() && engine().capabilities.formatting_profile === "latex";
const activeIsLatexSource = () => isLatex() && activeUsesEngineSource();
const supportsCitations = () =>
  engineLoaded() && activeUsesEngineSource() && engine().capabilities.features.includes("citations");
const supportsSyncTeX = () => engineLoaded() && engine().capabilities.supports_synctex;
const supportsIsolatedCompile = () =>
  engineLoaded() && engine().capabilities.supports_isolated_compile;
export const engineFormattingAvailable = () => engineLoaded() && activeUsesEngineSource();
export const runEngineFormatting = (action: EngineFormattingAction) => {
  if (!activeUsesEngineSource()) return;
  const formatting = formattingForEngine(engine(), engineLoaded(), action);
  if (!formatting) return;
  if (formatting.kind === "wrap") wrapSelection(formatting.before, formatting.after);
  else insertAtCursor(formatting.text);
};

const toggleTheme = () => window.dispatchEvent(new CustomEvent("oleafly:toggle-theme"));
const openNewProject = () => useSettingsStore.getState().setNewProjectOpen(true);
const themeLabel = (ctx: AppContext) =>
  `Switch to ${ctx.theme === "dark" ? "light" : "dark"} theme`;
const themeIcon = (ctx: AppContext) =>
  ctx.theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />;

export function registerOmnibarCommands() {
  registerCommand({
    id: "omnibar.create",
    surfaces: ["omnibar"],
    label: "Create a new project",
    keywords: "new project create template gallery",
    icon: () => <Plus className="size-4" />,
    order: 10,
    run: openNewProject,
  });
  registerCommand({
    id: "omnibar.theme",
    surfaces: ["omnibar"],
    label: themeLabel,
    keywords: "theme dark light appearance mode",
    icon: themeIcon,
    order: 20,
    run: toggleTheme,
  });
  // Figures insert into an open document, so only offer this with a project open.
  registerCommand({
    id: "omnibar.figure",
    surfaces: ["omnibar"],
    label: "Generate a figure with AI",
    keywords: "figure diagram draw tikz plot chart illustration",
    icon: () => <Sparkles className="size-4" />,
    order: 30,
    when: (ctx) => !!ctx.projectId && isLatex() && supportsIsolatedCompile(),
    run: () => {
      const s = useSettingsStore.getState();
      s.setRailTab("ai");
      if (!s.showTree) s.toggleTree();
      s.setFigureModeOpen(true);
    },
  });
  registerCommand({
    id: "omnibar.diagram",
    surfaces: ["omnibar"],
    label: "Insert a diagram (manual)",
    keywords: "diagram figure tikz manual composer draw insert paste",
    icon: () => <Workflow className="size-4" />,
    order: 40,
    when: (ctx) =>
      !!ctx.projectId && ctx.projectKind !== "image" && isLatex() && supportsIsolatedCompile(),
    run: () => useSettingsStore.getState().setDiagramComposerOpen(true),
  });
  registerCommand({
    id: "omnibar.settings",
    surfaces: ["omnibar"],
    label: "Open settings",
    keywords: "settings preferences options",
    icon: () => <Settings className="size-4" />,
    order: 50,
    run: () => useSettingsStore.getState().setSettingsOpen(true),
  });
}

export function registerPaletteCommands() {
  const ins = (text: string) => () => insertAtCursor(text);
  const palette = (
    cmd: Omit<Parameters<typeof registerCommand>[0], "surfaces">,
  ) => registerCommand({ ...cmd, surfaces: ["palette"] });

  palette({
    id: "palette.new-project",
    group: "Project",
    label: "New project…",
    icon: () => <FolderPlus className="size-4" />,
    order: 100,
    run: openNewProject,
  });

  palette({
    id: "palette.recompile",
    group: "Compile",
    label: "Recompile",
    icon: () => <Play className="size-4" />,
    hint: "⌘↵",
    order: 200,
    run: () => void useCompileStore.getState().recompile(),
  });
  palette({
    id: "palette.autocompile",
    group: "Compile",
    label: () =>
      useCompileStore.getState().autoCompile ? "Disable auto-compile" : "Enable auto-compile",
    icon: () => <Zap className="size-4" />,
    order: 210,
    run: () => {
      const c = useCompileStore.getState();
      c.setAutoCompile(!c.autoCompile);
    },
  });
  palette({
    id: "palette.synctex",
    group: "Compile",
    label: "Go to PDF (SyncTeX)",
    icon: () => <Crosshair className="size-4" />,
    hint: "⌘⇧J",
    order: 220,
    when: supportsSyncTeX,
    run: () => void forwardFromCursor(),
  });
  palette({
    id: "palette.export-pdf",
    group: "Compile",
    label: "Export PDF…",
    icon: () => <Download className="size-4" />,
    order: 230,
    run: () => void exportCurrentPdf(),
  });
  palette({
    id: "palette.clear-cache",
    group: "Compile",
    label: "Clear build cache & recompile",
    keywords: "clear build cache clean rebuild stale reset aux",
    icon: () => <Trash2 className="size-4" />,
    order: 240,
    when: (ctx) => !!ctx.projectId,
    run: (ctx) => {
      const pid = ctx.projectId;
      if (!pid) return;
      void (async () => {
        try {
          await clearBuildCache(pid);
        } catch {
          /* best effort: fall through to a normal recompile */
        }
        await useCompileStore.getState().recompile();
      })();
    },
  });

  palette({
    id: "palette.word-count",
    group: "Tools",
    label: "Word count",
    icon: () => <Sigma className="size-4" />,
    order: 300,
    run: () => useSettingsStore.getState().setWordCountOpen(true),
  });
  palette({
    id: "palette.history",
    group: "Tools",
    label: "History",
    icon: () => <List className="size-4" />,
    order: 310,
    run: () => useSettingsStore.getState().setHistoryOpen(true),
  });
  palette({
    id: "palette.add-citation",
    group: "Tools",
    label: "Add citation",
    icon: () => <Quote className="size-4" />,
    hint: "DOI / arXiv / title",
    order: 320,
    when: supportsCitations,
    run: () => useCitationStore.getState().setOpen(true),
  });

  palette({
    id: "palette.bold",
    group: "Insert",
    label: "Bold",
    icon: () => <Bold className="size-4" />,
    hint: "⌘B",
    order: 400,
    when: engineFormattingAvailable,
    run: () => runEngineFormatting("bold"),
  });
  palette({
    id: "palette.italic",
    group: "Insert",
    label: "Italic",
    icon: () => <Italic className="size-4" />,
    hint: "⌘I",
    order: 410,
    when: engineFormattingAvailable,
    run: () => runEngineFormatting("italic"),
  });
  palette({
    id: "palette.section",
    group: "Insert",
    label: "Section",
    icon: () => <Square className="size-4" />,
    order: 420,
    when: engineFormattingAvailable,
    run: () => runEngineFormatting("section"),
  });
  palette({
    id: "palette.list",
    group: "Insert",
    label: "Bulleted list",
    icon: () => <List className="size-4" />,
    order: 430,
    when: engineFormattingAvailable,
    run: () => runEngineFormatting("list"),
  });
  palette({
    id: "palette.figure",
    group: "Insert",
    label: "Figure",
    icon: () => <ImageIcon className="size-4" />,
    order: 440,
    when: activeIsLatexSource,
    run: ins(
      "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{}\n  \\caption{}\n\\end{figure}\n",
    ),
  });
  palette({
    id: "palette.table",
    group: "Insert",
    label: "Table",
    icon: () => <Table className="size-4" />,
    order: 450,
    when: activeIsLatexSource,
    run: ins(
      "\\begin{table}[htbp]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{ll}\n    & \\\\\n  \\end{tabular}\n\\end{table}\n",
    ),
  });
  palette({
    id: "palette.equation",
    group: "Insert",
    label: "Equation",
    icon: () => <Sigma className="size-4" />,
    order: 460,
    when: activeIsLatexSource,
    run: ins("\\begin{equation}\n  \n\\end{equation}\n"),
  });
  palette({
    id: "palette.label",
    group: "Insert",
    label: "Label",
    icon: () => <Tag className="size-4" />,
    order: 470,
    when: activeIsLatexSource,
    run: ins("\\label{}"),
  });

  palette({
    id: "palette.theme",
    group: "Settings",
    label: themeLabel,
    icon: themeIcon,
    order: 500,
    run: toggleTheme,
  });
  palette({
    id: "palette.vim",
    group: "Settings",
    label: () => (useSettingsStore.getState().vim ? "Disable vim mode" : "Enable vim mode"),
    icon: () => <CommandIcon className="size-4" />,
    order: 510,
    run: () => useSettingsStore.getState().toggleVim(),
  });
  palette({
    id: "palette.spellcheck",
    group: "Settings",
    label: () =>
      useSettingsStore.getState().spellcheck ? "Disable spellcheck" : "Enable spellcheck",
    icon: () => <Sigma className="size-4" />,
    order: 520,
    run: () => useSettingsStore.getState().toggleSpellcheck(),
  });
  palette({
    id: "palette.offline",
    group: "Settings",
    label: () =>
      useSettingsStore.getState().offline
        ? "Online mode (allow package fetch)"
        : "Offline mode (--only-cached)",
    icon: () => <Zap className="size-4" />,
    order: 530,
    run: () => {
      const s = useSettingsStore.getState();
      s.setOffline(!s.offline);
    },
  });
}

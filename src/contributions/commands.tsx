import {
  Bold,
  Command as CommandIcon,
  Crosshair,
  Download,
  FolderPlus,
  Image as ImageIcon,
  Italic,
  LibraryBig,
  List,
  Moon,
  PenTool,
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
  ToolCase,
  Trash2,
  Zap,
} from "lucide-react";
import { ClockCheck } from "@/components/icons/ClockCheck";
import { registerCommand, type AppContext } from "@oleafly/registry";
import { useSettingsStore } from "@/store/settings";
import { useCompileStore } from "@/store/compile";
import { useCitationStore } from "@/store/citation";
import { clearBuildCache } from "@/lib/tauri";
import { getEditorView, insertAtCursor, wrapSelection } from "@/components/editor/cm/controller";
import {
  closeEnvironmentAtCursor,
  surroundSelectionWithEnvironment,
} from "@oleafly/editor";
import { forwardFromCursor } from "@/features/synctex";
import { exportCurrentPdf } from "@/features/export";
import { useFilesStore } from "@/store/files";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { useHomeViewStore, type HomePage } from "@/store/home-view";
import {
  formattingForEngine,
  pathUsesEngineSource,
  type EngineFormattingAction,
} from "@/lib/document-engine";
import {
  TOOL_DEFINITIONS,
  type ToolDefinition,
} from "@/lib/tool-catalog";

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
const openHomePage = async (page: HomePage) => {
  const files = useFilesStore.getState();
  const home = useHomeViewStore.getState();
  home.closeTools();
  if (!files.projectId) {
    home.goTo(page);
    return;
  }

  home.queuePageAfterProjectClose(page);
  await files.closeProject();
  if (useFilesStore.getState().projectId) {
    useHomeViewStore.getState().clearQueuedPageAfterProjectClose();
  }
};
const openToolsGallery = async () => {
  const files = useFilesStore.getState();
  const home = useHomeViewStore.getState();
  home.openTools();
  if (!files.projectId) return;

  await files.closeProject();
  if (useFilesStore.getState().projectId) {
    useHomeViewStore.getState().closeTools();
  }
};
const themeLabel = (ctx: AppContext) =>
  `Switch to ${ctx.theme === "dark" ? "light" : "dark"} theme`;
const themeIcon = (ctx: AppContext) =>
  ctx.theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />;
const TOOL_COMMAND_ICON_COLOR: Record<ToolDefinition["tone"], string> = {
  rose: "text-rose-600 dark:text-rose-300",
  violet: "text-violet-600 dark:text-violet-300",
  emerald: "text-emerald-600 dark:text-emerald-300",
  cyan: "text-cyan-600 dark:text-cyan-300",
  blue: "text-blue-600 dark:text-blue-300",
  sky: "text-sky-600 dark:text-sky-300",
  amber: "text-amber-600 dark:text-amber-300",
};

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
    order: 40,
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
      s.setAssistantOpen(true);
      s.setFigureModeOpen(true);
    },
  });
  registerCommand({
    id: "omnibar.diagram-composer",
    surfaces: ["omnibar", "palette"],
    group: "Tools",
    label: "Open Diagram Composer",
    keywords: "diagram figure tikz composer draw canvas",
    slash: ["diagram-composer", "diagram"],
    hint: "/diagram-composer",
    icon: () => <PenTool className="size-4" />,
    order: 20,
    run: () => void openHomePage("diagram-composer"),
  });
  registerCommand({
    id: "omnibar.tools",
    surfaces: ["omnibar", "palette"],
    group: "Tools",
    label: "Open Oleafly Tools",
    keywords: "tools latex pdf equation bibtex table lab search deadlines gallery",
    slash: ["tools"],
    hint: "/tools",
    icon: () => <ToolCase className="size-4" />,
    order: 290,
    when: (ctx) => ctx.latexToolsEnabled === true,
    run: () => void openToolsGallery(),
  });
  TOOL_DEFINITIONS.forEach((tool, index) => {
    registerCommand({
      id: `tool.${tool.id}`,
      surfaces: ["omnibar", "palette"],
      group: "Tools",
      label: `Open ${tool.name}`,
      keywords: `${tool.name} ${tool.description} ${tool.tags.join(" ")} ${tool.slash.join(" ")}`,
      slash: tool.slash,
      hint: `/${tool.slash[0]}`,
      icon: () => (
        <tool.icon
          className={`size-4 ${TOOL_COMMAND_ICON_COLOR[tool.tone]}`}
        />
      ),
      order: 330 + index,
      when: (ctx) => ctx.latexToolsEnabled === true,
      run: () => void openHomePage(tool.page),
    });
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
    label: "Git history",
    icon: () => <List className="size-4" />,
    order: 310,
    run: () => useSettingsStore.getState().openVersioning("git"),
  });
  palette({
    id: "palette.checkpoints",
    group: "Tools",
    label: "Checkpoints",
    icon: () => <ClockCheck className="size-4" />,
    order: 315,
    run: () => useSettingsStore.getState().openVersioning("checkpoints"),
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
    id: "document-citation-scan",
    group: "Tools",
    label: "Find citations in document",
    keywords: "citations literature scan document paragraph references find",
    icon: () => <LibraryBig className="size-4 text-blue-600 dark:text-blue-300" />,
    order: 322,
    run: () => {
      // Capture selection (or active/main .tex content) and .bib filter text
      // before openHomePage closes the project and clears the files store.
      const view = getEditorView();
      const files = useFilesStore.getState();
      let source: string | undefined;
      if (view) {
        const sel = view.state.selection.main;
        if (sel.from !== sel.to) {
          const selected = view.state.sliceDoc(sel.from, sel.to).trim();
          if (selected) source = selected;
        }
      }
      if (!source) {
        const active = files.activePath;
        if (active && /\.tex$/i.test(active)) {
          const content = files.files[active]?.content?.trim();
          if (content) source = content;
        }
        if (!source && files.mainDoc) {
          const content = files.files[files.mainDoc]?.content?.trim();
          if (content) source = content;
        }
      }
      const bibOverride =
        files.tree
          .filter((entry) => !entry.is_dir && entry.path.endsWith(".bib"))
          .map((entry) => files.files[entry.path]?.content ?? "")
          .filter(Boolean)
          .join("\n\n") || null;
      useDocumentCitationUiStore
        .getState()
        .requestDocumentScan(source, bibOverride);
      void openHomePage("literature-search");
    },
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
    id: "palette.close-environment",
    group: "Editor",
    label: "Close LaTeX environment",
    keywords: "close end environment begin latex",
    icon: () => <Square className="size-4" />,
    order: 480,
    when: activeIsLatexSource,
    run: () => {
      const view = getEditorView();
      if (!view) return;
      const spec = closeEnvironmentAtCursor(view.state);
      if (!spec) return;
      view.dispatch(spec);
      view.focus();
    },
  });
  palette({
    id: "palette.surround-environment",
    group: "Editor",
    label: "Surround with environment",
    keywords: "surround wrap environment begin end latex",
    icon: () => <PenTool className="size-4" />,
    order: 490,
    when: activeIsLatexSource,
    run: () => {
      const view = getEditorView();
      if (!view) return;
      if (surroundSelectionWithEnvironment(view)) view.focus();
    },
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

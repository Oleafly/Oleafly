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
  Monitor,
  Moon,
  PenTool,
  Play,
  Plus,
  Quote,
  Settings,
  Sigma,
  Sparkles,
  Square,
  SquareTerminal,
  Sun,
  Table,
  Tag,
  ToolCase,
  Trash2,
  Zap,
} from "lucide-react";
import { ClockCheck } from "@/components/icons/ClockCheck";
import { registerCommand, type AppContext } from "@oleafly/registry";
import { i18n } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useCompileStore } from "@/store/compile";
import { useCitationStore } from "@/store/citation";
import { clearBuildCache } from "@/lib/tauri";
import { getEditorView, insertAtCursor, wrapSelection } from "@/components/editor/cm/controller";
import {
  closeEnvironmentAtCursor,
  surroundSelectionWithEnvironment,
} from "@oleafly/editor";
import { handoffToAssistant } from "@/features/assistant-handoff";
import { forwardFromCursor } from "@/features/synctex";
import { exportCurrentPdf } from "@/features/export";
import { useFilesStore } from "@/store/files";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { TERMINAL_LIMIT, terminalLimitMessage, useTerminalsStore } from "@/store/terminals";
import { toast } from "@/lib/toast";
import { runCiteOleaflyAction } from "@/features/cite-oleafly";
import { requestThemePreference } from "@/lib/theme";
import {
  formattingForEngine,
  pathUsesEngineSource,
  type EngineFormattingAction,
} from "@/lib/document-engine";
import {
  TOOL_DEFINITIONS,
  toolDescription,
  toolName,
  toolTags,
  type ToolDefinition,
} from "@/lib/tool-catalog";
import {
  openHomePage,
  openTool,
  openToolsGallery,
} from "@/features/open-tool";

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
const ENGLISH_KEYWORDS = {
  createProject: "new project create template gallery",
  theme: "theme dark light appearance mode",
  generateFigure: "figure diagram draw tikz plot chart illustration",
  diagramComposer: "diagram figure tikz composer draw canvas",
  tools: "tools latex pdf equation bibtex table lab search deadlines gallery",
  settings: "settings preferences options",
  clearCache: "clear build cache clean rebuild stale reset aux",
  newTerminal: "terminal shell console new",
  documentCitationScan: "citations literature scan document paragraph references find",
  citeOleafly: "citation bibtex bibliography acknowledge oleafly",
  closeEnvironment: "close end environment begin latex",
  surroundEnvironment: "surround wrap environment begin end latex",
  appearance: "theme appearance mode",
} as const;

const APPEARANCE_LABEL = {
  system: () => i18n.t(($) => $.shell.commands.appearance.useSystem),
  light: () => i18n.t(($) => $.shell.commands.appearance.useLight),
  dark: () => i18n.t(($) => $.shell.commands.appearance.useDark),
} as const;

const themeLabel = (ctx: AppContext) =>
  ctx.theme === "dark"
    ? i18n.t(($) => $.shell.commands.theme.toLight)
    : i18n.t(($) => $.shell.commands.theme.toDark);
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
    label: () => i18n.t(($) => $.shell.commands.createProject.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.createProject.keywords)} ${ENGLISH_KEYWORDS.createProject}`,
    icon: () => <Plus className="size-4" />,
    order: 10,
    run: openNewProject,
  });
  registerCommand({
    id: "omnibar.theme",
    surfaces: ["omnibar"],
    label: themeLabel,
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.theme.keywords)} ${ENGLISH_KEYWORDS.theme}`,
    icon: themeIcon,
    order: 40,
    run: toggleTheme,
  });
  // Figures insert into an open document, so only offer this with a project open.
  registerCommand({
    id: "omnibar.figure",
    surfaces: ["omnibar"],
    label: () => i18n.t(($) => $.shell.commands.generateFigure.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.generateFigure.keywords)} ${ENGLISH_KEYWORDS.generateFigure}`,
    icon: () => <Sparkles className="size-4" />,
    order: 30,
    when: (ctx) => !!ctx.projectId && isLatex() && supportsIsolatedCompile(),
    run: () => {
      useSettingsStore.getState().setAssistantOpen(true);
      handoffToAssistant("Draw a figure of ");
    },
  });
  registerCommand({
    id: "omnibar.diagram-composer",
    surfaces: ["omnibar", "palette"],
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.diagramComposer.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.diagramComposer.keywords)} ${ENGLISH_KEYWORDS.diagramComposer}`,
    slash: ["diagram-composer", "diagram"],
    hint: "/diagram-composer",
    icon: () => <PenTool className="size-4" />,
    order: 20,
    run: () => void openHomePage("diagram-composer"),
  });
  registerCommand({
    id: "omnibar.tools",
    surfaces: ["omnibar", "palette"],
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.tools.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.tools.keywords)} ${ENGLISH_KEYWORDS.tools}`,
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
      group: () => i18n.t(($) => $.shell.commandGroups.tools),
      label: () => i18n.t(($) => $.shell.commands.openTool, { name: toolName(tool.id) }),
      keywords: () =>
        `${toolName(tool.id)} ${toolDescription(tool.id)} ${toolTags(tool.id).join(" ")} ${tool.slash.join(" ")}`,
      slash: tool.slash,
      hint: `/${tool.slash[0]}`,
      icon: () => (
        <tool.icon
          className={`size-4 ${TOOL_COMMAND_ICON_COLOR[tool.tone]}`}
        />
      ),
      order: 330 + index,
      when: (ctx) => ctx.latexToolsEnabled === true,
      run: () => void openTool(tool),
    });
  });
  registerCommand({
    id: "omnibar.settings",
    surfaces: ["omnibar"],
    label: () => i18n.t(($) => $.shell.commands.settings.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.settings.keywords)} ${ENGLISH_KEYWORDS.settings}`,
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
    group: () => i18n.t(($) => $.shell.commandGroups.project),
    label: () => i18n.t(($) => $.shell.commands.newProject.label),
    icon: () => <FolderPlus className="size-4" />,
    order: 100,
    run: openNewProject,
  });

  palette({
    id: "palette.recompile",
    group: () => i18n.t(($) => $.shell.commandGroups.compile),
    label: () => i18n.t(($) => $.shell.commands.recompile.label),
    icon: () => <Play className="size-4" />,
    hint: "⌘↵",
    order: 200,
    run: () => void useCompileStore.getState().recompile(),
  });
  palette({
    id: "palette.autocompile",
    group: () => i18n.t(($) => $.shell.commandGroups.compile),
    label: () =>
      useCompileStore.getState().autoCompile
        ? i18n.t(($) => $.shell.commands.autoCompile.disable)
        : i18n.t(($) => $.shell.commands.autoCompile.enable),
    icon: () => <Zap className="size-4" />,
    order: 210,
    run: () => {
      const c = useCompileStore.getState();
      c.setAutoCompile(!c.autoCompile);
    },
  });
  palette({
    id: "palette.synctex",
    group: () => i18n.t(($) => $.shell.commandGroups.compile),
    label: () => i18n.t(($) => $.shell.commands.synctex.label),
    icon: () => <Crosshair className="size-4" />,
    hint: "⌘⇧J",
    order: 220,
    when: supportsSyncTeX,
    run: () => void forwardFromCursor(),
  });
  palette({
    id: "palette.export-pdf",
    group: () => i18n.t(($) => $.shell.commandGroups.compile),
    label: () => i18n.t(($) => $.shell.commands.exportPdf.label),
    icon: () => <Download className="size-4" />,
    order: 230,
    run: () => void exportCurrentPdf(),
  });
  palette({
    id: "palette.clear-cache",
    group: () => i18n.t(($) => $.shell.commandGroups.compile),
    label: () => i18n.t(($) => $.shell.commands.clearCache.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.clearCache.keywords)} ${ENGLISH_KEYWORDS.clearCache}`,
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
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.wordCount.label),
    icon: () => <Sigma className="size-4" />,
    order: 300,
    run: () => useSettingsStore.getState().setWordCountOpen(true),
  });
  palette({
    id: "palette.history",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.gitHistory.label),
    icon: () => <List className="size-4" />,
    order: 310,
    run: () => useSettingsStore.getState().openVersioning("git"),
  });
  palette({
    id: "palette.checkpoints",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.checkpoints.label),
    icon: () => <ClockCheck className="size-4" />,
    order: 315,
    run: () => useSettingsStore.getState().openVersioning("checkpoints"),
  });
  palette({
    id: "palette.new-terminal",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.newTerminal.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.newTerminal.keywords)} ${ENGLISH_KEYWORDS.newTerminal}`,
    icon: () => <SquareTerminal className="size-4" />,
    order: 318,
    when: (ctx) => !!ctx.projectId,
    run: () => {
      const terminals = useTerminalsStore.getState();
      if (terminals.projectId && terminals.tabs.length >= TERMINAL_LIMIT) {
        toast.info(terminalLimitMessage());
        return;
      }
      useSettingsStore.getState().setTerminalOpen(true);
      terminals.addTerminal();
    },
  });
  palette({
    id: "palette.add-citation",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.addCitation.label),
    icon: () => <Quote className="size-4" />,
    hint: () => i18n.t(($) => $.shell.commands.addCitation.hint),
    order: 320,
    when: supportsCitations,
    run: () => useCitationStore.getState().setOpen(true),
  });
  palette({
    id: "document-citation-scan",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.documentCitationScan.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.documentCitationScan.keywords)} ${ENGLISH_KEYWORDS.documentCitationScan}`,
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
    id: "palette.cite-oleafly",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.citeOleafly.label),
    icon: () => <Quote className="size-4" />,
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.citeOleafly.keywords)} ${ENGLISH_KEYWORDS.citeOleafly}`,
    order: 395,
    when: (ctx) => !!ctx.projectId,
    run: () => void runCiteOleaflyAction(),
  });
  palette({
    id: "palette.bold",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.bold.label),
    icon: () => <Bold className="size-4" />,
    hint: "⌘B",
    order: 400,
    when: engineFormattingAvailable,
    run: () => runEngineFormatting("bold"),
  });
  palette({
    id: "palette.italic",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.italic.label),
    icon: () => <Italic className="size-4" />,
    hint: "⌘I",
    order: 410,
    when: engineFormattingAvailable,
    run: () => runEngineFormatting("italic"),
  });
  palette({
    id: "palette.section",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.section.label),
    icon: () => <Square className="size-4" />,
    order: 420,
    when: engineFormattingAvailable,
    run: () => runEngineFormatting("section"),
  });
  palette({
    id: "palette.list",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.list.label),
    icon: () => <List className="size-4" />,
    order: 430,
    when: engineFormattingAvailable,
    run: () => runEngineFormatting("list"),
  });
  palette({
    id: "palette.figure",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.figure.label),
    icon: () => <ImageIcon className="size-4" />,
    order: 440,
    when: activeIsLatexSource,
    run: ins(
      "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{}\n  \\caption{}\n\\end{figure}\n",
    ),
  });
  palette({
    id: "palette.table",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.table.label),
    icon: () => <Table className="size-4" />,
    order: 450,
    when: activeIsLatexSource,
    run: ins(
      "\\begin{table}[htbp]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{ll}\n    & \\\\\n  \\end{tabular}\n\\end{table}\n",
    ),
  });
  palette({
    id: "palette.equation",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.equation.label),
    icon: () => <Sigma className="size-4" />,
    order: 460,
    when: activeIsLatexSource,
    run: ins("\\begin{equation}\n  \n\\end{equation}\n"),
  });
  palette({
    id: "palette.label",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.label.label),
    icon: () => <Tag className="size-4" />,
    order: 470,
    when: activeIsLatexSource,
    run: ins("\\label{}"),
  });

  palette({
    id: "palette.close-environment",
    group: () => i18n.t(($) => $.shell.commandGroups.editor),
    label: () => i18n.t(($) => $.shell.commands.closeEnvironment.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.closeEnvironment.keywords)} ${ENGLISH_KEYWORDS.closeEnvironment}`,
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
    group: () => i18n.t(($) => $.shell.commandGroups.editor),
    label: () => i18n.t(($) => $.shell.commands.surroundEnvironment.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.surroundEnvironment.keywords)} ${ENGLISH_KEYWORDS.surroundEnvironment}`,
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
    group: () => i18n.t(($) => $.shell.commandGroups.settings),
    label: themeLabel,
    icon: themeIcon,
    order: 500,
    run: toggleTheme,
  });
  for (const [preference, Icon, order] of [
    ["system", Monitor, 501],
    ["light", Sun, 502],
    ["dark", Moon, 503],
  ] as const) {
    palette({
      id: `palette.theme-${preference}`,
      group: () => i18n.t(($) => $.shell.commandGroups.settings),
      label: APPEARANCE_LABEL[preference],
      keywords: () =>
        `${i18n.t(($) => $.shell.commands.appearance.keywords)} ${ENGLISH_KEYWORDS.appearance} ${preference}`,
      icon: () => <Icon className="size-4" />,
      order,
      run: () => requestThemePreference(preference),
    });
  }
  palette({
    id: "palette.vim",
    group: () => i18n.t(($) => $.shell.commandGroups.settings),
    label: () =>
      useSettingsStore.getState().vim
        ? i18n.t(($) => $.shell.commands.vim.disable)
        : i18n.t(($) => $.shell.commands.vim.enable),
    icon: () => <CommandIcon className="size-4" />,
    order: 510,
    run: () => useSettingsStore.getState().toggleVim(),
  });
  palette({
    id: "palette.spellcheck",
    group: () => i18n.t(($) => $.shell.commandGroups.settings),
    label: () =>
      useSettingsStore.getState().spellcheck
        ? i18n.t(($) => $.shell.commands.spellcheck.disable)
        : i18n.t(($) => $.shell.commands.spellcheck.enable),
    icon: () => <Sigma className="size-4" />,
    order: 520,
    run: () => useSettingsStore.getState().toggleSpellcheck(),
  });
  palette({
    id: "palette.offline",
    group: () => i18n.t(($) => $.shell.commandGroups.settings),
    label: () =>
      useSettingsStore.getState().offline
        ? i18n.t(($) => $.shell.commands.offline.online)
        : i18n.t(($) => $.shell.commands.offline.offline),
    icon: () => <Zap className="size-4" />,
    order: 530,
    run: () => {
      const s = useSettingsStore.getState();
      s.setOffline(!s.offline);
    },
  });
}

import {
  AlignLeft,
  ArrowRightToLine,
  Asterisk,
  Bold,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Command as CommandIcon,
  CopyPlus,
  Code,
  Crosshair,
  Divide,
  Download,
  Eraser,
  FileJson,
  FolderOpen,
  FolderPlus,
  Hash,
  Image as ImageIcon,
  Italic,
  LibraryBig,
  Link,
  List,
  MessageSquareCode,
  Monitor,
  Moon,
  Package,
  Pencil,
  PenTool,
  Play,
  Plus,
  Quote,
  Rows3,
  ScanSearch,
  SearchCode,
  Settings,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareTerminal,
  Strikethrough,
  Sun,
  Table,
  Tag,
  ToolCase,
  Trash2,
  Underline,
  X,
  Zap,
} from "lucide-react";
import { ClockCheck } from "@/components/icons/ClockCheck";
import { registerCommand, type AppContext } from "@oleafly/registry";
import { i18n } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useCompileStore } from "@/store/compile";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";
import { useCitationStore } from "@/store/citation";
import { clearBuildCache } from "@/lib/tauri";
import { getEditorView, insertAtCursor, wrapSelection } from "@/components/editor/cm/controller";
import {
  closeEnvironmentAtCursor,
  deleteLineCommand,
  duplicateSelection,
  lowercaseSelection,
  surroundSelectionWithEnvironment,
  titleCaseSelection,
  uppercaseSelection,
} from "@oleafly/editor";
import { handoffToAssistant } from "@/features/assistant-handoff";
import { forwardFromCursor } from "@/features/synctex";
import { exportCurrentPdf } from "@/features/export";
import { useFilesStore } from "@/store/files";
import {
  closeAllEditorTabs,
  closeAssistantTabs,
  currentEditorTabs,
  openAssistantTabs,
} from "@/components/editor/editor-tabs";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { TERMINAL_LIMIT, terminalLimitMessage, useTerminalsStore } from "@/store/terminals";
import { toast } from "@/lib/toast";
import { runCiteOleaflyAction } from "@/features/cite-oleafly";
import { requestThemePreference } from "@/lib/theme";
import { showSourceControlGraph } from "@/lib/source-control-events";
import {
  engineSyncsPath,
  formattingForPath,
  formattingProfileForPath,
  pathUsesEngineSource,
  sourceLanguageForPath,
  supportsFigureTools,
  type EngineFormattingAction,
} from "@/lib/document-engine";
import { findReferences, goToDefinition, startRename } from "@/lib/index/nav";
import {
  addTypstLabel,
  insertTypstAlignedMath,
  insertTypstDisplayMath,
  insertTypstFigure,
  insertTypstFootnote,
  insertTypstFraction,
  insertTypstLink,
  insertTypstMath,
  insertTypstNumberedEquation,
  insertTypstQuote,
  insertTypstRawInline,
  insertTypstReference,
  insertTypstStrikethrough,
  insertTypstTable,
  insertTypstUnderline,
  toggleTypstComment,
  typstLanguageServiceOffers,
} from "@/components/editor/typst-commands";
import {
  TOOL_DEFINITIONS,
  toolDescription,
  toolName,
  toolTags,
  type ToolDefinition,
} from "@/lib/tool-catalog";
import {
  openDiagramComposerChooser,
  openHomePage,
  openTool,
  openToolsGallery,
} from "@/features/open-tool";
import { openFolderWithPicker } from "@/features/open-folder";
import { openTypstPackages } from "@/components/typst-packages/open";
import { openLatexPackages } from "@/components/packages/open";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { shortcut } from "@/lib/utils";
import {
  formatWithLanguageService,
  languageServiceFormattingAvailable,
  type FormatScope,
} from "@/components/editor/cm/language-service-format";

const engine = () => useFilesStore.getState().engine;
const engineLoaded = () => useFilesStore.getState().engineLoaded;
const activeUsesEngineSource = () => {
  const files = useFilesStore.getState();
  return pathUsesEngineSource(files.engine, files.activePath);
};
const activeSourceLanguage = () =>
  engineLoaded() ? sourceLanguageForPath(useFilesStore.getState().activePath) : null;
const activeIsLatexSource = () => activeSourceLanguage() === "latex";
const activeIsTypstSource = () => activeSourceLanguage() === "typst";
const activeIsLatexOrTypstSource = () => activeIsLatexSource() || activeIsTypstSource();
const supportsCitations = () =>
  engineLoaded() && activeUsesEngineSource() && engine().capabilities.features.includes("citations");
const supportsSyncTeX = () => engineLoaded() && engineSyncsPath(engine(), useFilesStore.getState().activePath);
const activeFormattingProfile = () =>
  formattingProfileForPath(engine(), engineLoaded(), useFilesStore.getState().activePath);
export const engineFormattingAvailable = () => engineLoaded() && activeFormattingProfile() !== "none";
export const runEngineFormatting = (action: EngineFormattingAction) => {
  if (!engineFormattingAvailable()) return;
  const formatting = formattingForPath(engine(), engineLoaded(), useFilesStore.getState().activePath, action);
  if (!formatting) return;
  if (formatting.kind === "wrap") wrapSelection(formatting.before, formatting.after);
  else insertAtCursor(formatting.text);
};

const toggleTheme = () => window.dispatchEvent(new CustomEvent("oleafly:toggle-theme"));
const openNewProject = () => useSettingsStore.getState().setNewProjectOpen(true);
const ENGLISH_KEYWORDS = {
  createProject: "new project create template gallery",
  theme: "theme dark light appearance mode",
  generateFigure: "figure diagram draw tikz cetz fletcher typst plot chart illustration",
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
  saveSettingsToFolder: "save project settings folder project.json share main document engine",
  openFolder: "open folder directory existing local files disk",
  formatDocument: "format tidy indent typstyle typst",
  formatSelection: "format selection tidy indent typstyle typst",
  typstPackages: "typst universe packages import library browse vendor",
  latexPackages: "latex ctan packages usepackage preamble install tlmgr browse",
  closeAllEditorTabs: "close all editor tabs files",
  closeAssistantTabs: "close editor tabs files assistant ai agent opened",
} as const;

const runLanguageServiceFormat = (scope: FormatScope) => {
  const view = getEditorView();
  if (!view) return;
  void formatWithLanguageService(view, scope);
  view.focus();
};

const EDITOR_COMMAND_KEYWORDS = {
  uppercase: "uppercase upper case capitals selection",
  lowercase: "lowercase lower case selection",
  titleCase: "title case capitalize selection",
  duplicate: "duplicate copy line selection",
  deleteLine: "delete remove line",
} as const;

const EDITOR_COMMAND_PALETTE = [
  { id: "uppercase", run: uppercaseSelection, icon: CaseUpper, order: 491 },
  { id: "lowercase", run: lowercaseSelection, icon: CaseLower, order: 492 },
  { id: "titleCase", run: titleCaseSelection, icon: CaseSensitive, order: 493 },
  { id: "duplicate", run: duplicateSelection, icon: CopyPlus, order: 494 },
  { id: "deleteLine", run: deleteLineCommand, icon: Eraser, order: 495 },
] as const;

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

type CommandFilesState = ReturnType<typeof useFilesStore.getState>;

function selectedEditorText(): string | undefined {
  const view = getEditorView();
  if (!view) return undefined;
  const sel = view.state.selection.main;
  if (sel.from === sel.to) return undefined;
  return view.state.sliceDoc(sel.from, sel.to).trim() || undefined;
}

function documentScanSource(files: CommandFilesState): string | undefined {
  const selected = selectedEditorText();
  if (selected) return selected;
  const active = files.activePath;
  if (active && /\.tex$/i.test(active)) {
    const content = files.files[active]?.content?.trim();
    if (content) return content;
  }
  if (files.mainDoc) {
    const content = files.files[files.mainDoc]?.content?.trim();
    if (content) return content;
  }
  return undefined;
}

function documentScanBibOverride(files: CommandFilesState): string | null {
  return (
    files.tree
      .filter((entry) => !entry.is_dir && entry.path.endsWith(".bib"))
      .map((entry) => files.files[entry.path]?.content ?? "")
      .filter(Boolean)
      .join("\n\n") || null
  );
}

type PaletteRegistrar = (cmd: Omit<Parameters<typeof registerCommand>[0], "surfaces">) => void;

const TYPST_NAVIGATION_KEYWORDS = {
  goToDefinition: "definition jump symbol navigate typst",
  findReferences: "references usages symbol typst",
  renameSymbol: "rename symbol refactor typst",
  toggleComment: "comment uncomment line block typst",
} as const;

const DOCUMENT_SETTINGS_KEYWORDS =
  "documentclass geometry babel polyglossia fontspec setspace secnumdepth numberwithin yaml frontmatter pandoc mainfont variants";

function runWithEditorView(action: (view: NonNullable<ReturnType<typeof getEditorView>>) => unknown) {
  const view = getEditorView();
  if (view) action(view);
}

function registerTypstPaletteCommands(palette: PaletteRegistrar) {
  const insertGroup = () => i18n.t(($) => $.shell.commandGroups.insert);
  const editorGroup = () => i18n.t(($) => $.shell.commandGroups.editor);
  const insertions = [
    ["underline", () => i18n.t(($) => $.shell.commands.underline.label), Underline, 411, insertTypstUnderline],
    ["strikethrough", () => i18n.t(($) => $.shell.commands.strikethrough.label), Strikethrough, 412, insertTypstStrikethrough],
    ["inline-code", () => i18n.t(($) => $.shell.commands.inlineCode.label), Code, 413, insertTypstRawInline],
    ["link", () => i18n.t(($) => $.shell.commands.link.label), Link, 414, insertTypstLink],
    ["footnote", () => i18n.t(($) => $.shell.commands.footnote.label), Asterisk, 435, insertTypstFootnote],
    ["quote", () => i18n.t(($) => $.shell.commands.quote.label), Quote, 436, insertTypstQuote],
    ["inline-math", () => i18n.t(($) => $.shell.commands.inlineMath.label), Sigma, 461, insertTypstMath],
    [
      "numbered-equation",
      () => i18n.t(($) => $.shell.commands.numberedEquation.label),
      Hash,
      462,
      () => void insertTypstNumberedEquation(),
    ],
    ["aligned-equations", () => i18n.t(($) => $.shell.commands.alignedEquations.label), Rows3, 463, insertTypstAlignedMath],
    ["fraction", () => i18n.t(($) => $.shell.commands.fraction.label), Divide, 464, insertTypstFraction],
    ["cross-reference", () => i18n.t(($) => $.shell.commands.crossReference.label), Tag, 471, insertTypstReference],
  ] as const;
  for (const [id, label, Icon, order, run] of insertions) {
    palette({
      id: `palette.typst-${id}`,
      group: insertGroup,
      label,
      icon: () => <Icon className="size-4" />,
      order,
      when: activeIsTypstSource,
      run,
    });
  }
  const insightsProject = () => {
    if (!engineLoaded()) return false;
    const format = engine().source_format;
    if (format === "latex") {
      const kind = useFilesStore.getState().projectKind;
      return kind !== "diagram" && kind !== "image";
    }
    return format === "typst" || format === "markdown";
  };
  palette({
    id: "palette.document-insights",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.typstInsights.label),
    keywords: () => i18n.t(($) => $.shell.commands.typstInsights.keywords),
    icon: () => <ScanSearch className="size-4" />,
    order: 296,
    when: insightsProject,
    run: () => useTypstDocumentPanelStore.getState().openPanel("insights"),
  });
  palette({
    id: "palette.document-settings",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.typstDocumentSettings.label),
    keywords: () => `${i18n.t(($) => $.shell.commands.typstDocumentSettings.keywords)} ${DOCUMENT_SETTINGS_KEYWORDS}`,
    icon: () => <SlidersHorizontal className="size-4" />,
    order: 297,
    when: insightsProject,
    run: () => useTypstDocumentPanelStore.getState().openPanel("settings"),
  });
  const navigation = [
    {
      id: "go-to-definition",
      feature: "definition",
      label: () => i18n.t(($) => $.shell.commands.goToDefinition.label),
      keywords: () =>
        `${i18n.t(($) => $.shell.commands.goToDefinition.keywords)} ${TYPST_NAVIGATION_KEYWORDS.goToDefinition}`,
      icon: ArrowRightToLine,
      hint: "F12",
      order: 482,
      run: goToDefinition,
    },
    {
      id: "find-references",
      feature: "references",
      label: () => i18n.t(($) => $.shell.commands.findReferences.label),
      keywords: () =>
        `${i18n.t(($) => $.shell.commands.findReferences.keywords)} ${TYPST_NAVIGATION_KEYWORDS.findReferences}`,
      icon: SearchCode,
      hint: "⇧F12",
      order: 483,
      run: findReferences,
    },
    {
      id: "rename-symbol",
      feature: "rename",
      label: () => i18n.t(($) => $.shell.commands.renameSymbol.label),
      keywords: () =>
        `${i18n.t(($) => $.shell.commands.renameSymbol.keywords)} ${TYPST_NAVIGATION_KEYWORDS.renameSymbol}`,
      icon: Pencil,
      hint: "F2",
      order: 484,
      run: startRename,
    },
  ] as const;
  for (const entry of navigation) {
    palette({
      id: `palette.typst-${entry.id}`,
      group: editorGroup,
      label: entry.label,
      keywords: entry.keywords,
      icon: () => <entry.icon className="size-4" />,
      hint: () => shortcut(entry.hint),
      order: entry.order,
      when: () => activeIsTypstSource() && typstLanguageServiceOffers(entry.feature),
      run: () => runWithEditorView(entry.run),
    });
  }
  palette({
    id: "palette.typst-toggle-comment",
    group: editorGroup,
    label: () => i18n.t(($) => $.shell.commands.toggleComment.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.toggleComment.keywords)} ${TYPST_NAVIGATION_KEYWORDS.toggleComment}`,
    icon: () => <MessageSquareCode className="size-4" />,
    hint: () => shortcut("⌘/"),
    order: 485,
    when: activeIsTypstSource,
    run: toggleTypstComment,
  });
}

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
    when: (ctx) => !!ctx.projectId && supportsFigureTools(engine(), engineLoaded()),
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
    run: () => openDiagramComposerChooser(),
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
    surfaces: ["omnibar", "palette"],
    group: () => i18n.t(($) => $.shell.commandGroups.settings),
    label: () => i18n.t(($) => $.shell.commands.settings.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.settings.keywords)} ${ENGLISH_KEYWORDS.settings}`,
    icon: () => <Settings className="size-4" />,
    hint: () => shortcutLabel(useShortcutStore.getState().bindings.openSettings),
    order: 50,
    run: () => useSettingsStore.getState().setSettingsOpen(true),
  });
}

export function registerPaletteCommands() {
  const ins = (text: string) => () => insertAtCursor(text);
  const latexFigure = ins(
    "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{}\n  \\caption{}\n\\end{figure}\n",
  );
  const latexTable = ins(
    "\\begin{table}[htbp]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{ll}\n    & \\\\\n  \\end{tabular}\n\\end{table}\n",
  );
  const latexEquation = ins("\\begin{equation}\n  \n\\end{equation}\n");
  const latexLabel = ins(String.raw`\label{}`);
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
  registerCommand({
    id: "palette.open-folder",
    surfaces: ["omnibar", "palette"],
    group: () => i18n.t(($) => $.shell.commandGroups.project),
    label: () => i18n.t(($) => $.shell.commands.openFolder.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.openFolder.keywords)} ${ENGLISH_KEYWORDS.openFolder}`,
    icon: () => <FolderOpen className="size-4" />,
    hint: () => shortcutLabel(useShortcutStore.getState().bindings.openFolder),
    order: 110,
    run: () => void openFolderWithPicker(),
  });
  palette({
    id: "palette.save-settings-to-folder",
    group: () => i18n.t(($) => $.shell.commandGroups.project),
    label: () => i18n.t(($) => $.shell.commands.saveSettingsToFolder.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.saveSettingsToFolder.keywords)} ${ENGLISH_KEYWORDS.saveSettingsToFolder}`,
    icon: () => <FileJson className="size-4" />,
    order: 120,
    when: (ctx) => !!ctx.projectId && useFilesStore.getState().manifestHome === "device",
    run: () => void useFilesStore.getState().saveSettingsToFolder(),
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
    label: () =>
      engineLoaded() && engine().id === "typst"
        ? i18n.t(($) => $.shell.commands.synctex.typstLabel)
        : i18n.t(($) => $.shell.commands.synctex.label),
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
    when: (ctx) => !!ctx.projectId,
    run: () => {
      const settings = useSettingsStore.getState();
      settings.setRailTab("source");
      settings.setShowTree(true);
      showSourceControlGraph();
    },
  });
  palette({
    id: "palette.checkpoints",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.checkpoints.label),
    icon: () => <ClockCheck className="size-4" />,
    order: 315,
    run: () => useSettingsStore.getState().openVersioning(),
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
      useSettingsStore.getState().setTerminalOpen(true);
      if (terminals.projectId && terminals.tabs.length >= TERMINAL_LIMIT) {
        toast.infoUnique("terminal-limit", terminalLimitMessage());
        return;
      }
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
    id: "palette.typst-packages",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.typstPackages.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.typstPackages.keywords)} ${ENGLISH_KEYWORDS.typstPackages}`,
    icon: () => <Package className="size-4" />,
    order: 321,
    when: (ctx) => !!ctx.projectId && engineLoaded() && engine().id === "typst",
    run: openTypstPackages,
  });
  palette({
    id: "palette.latex-packages",
    group: () => i18n.t(($) => $.shell.commandGroups.tools),
    label: () => i18n.t(($) => $.shell.commands.latexPackages.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.latexPackages.keywords)} ${ENGLISH_KEYWORDS.latexPackages}`,
    icon: () => <Package className="size-4" />,
    order: 321,
    when: (ctx) => !!ctx.projectId && engineLoaded() && engine().source_format === "latex",
    run: openLatexPackages,
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
      const files = useFilesStore.getState();
      useDocumentCitationUiStore
        .getState()
        .requestDocumentScan(
          documentScanSource(files),
          documentScanBibOverride(files),
        );
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
    when: activeIsLatexOrTypstSource,
    run: () => {
      if (activeIsTypstSource()) void insertTypstFigure();
      else latexFigure();
    },
  });
  palette({
    id: "palette.table",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.table.label),
    icon: () => <Table className="size-4" />,
    order: 450,
    when: activeIsLatexOrTypstSource,
    run: () => {
      if (activeIsTypstSource()) void insertTypstTable(2, 2);
      else latexTable();
    },
  });
  palette({
    id: "palette.equation",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.equation.label),
    icon: () => <Sigma className="size-4" />,
    order: 460,
    when: activeIsLatexOrTypstSource,
    run: () => {
      if (activeIsTypstSource()) insertTypstDisplayMath();
      else latexEquation();
    },
  });
  palette({
    id: "palette.label",
    group: () => i18n.t(($) => $.shell.commandGroups.insert),
    label: () => i18n.t(($) => $.shell.commands.label.label),
    icon: () => <Tag className="size-4" />,
    order: 470,
    when: activeIsLatexOrTypstSource,
    run: () => {
      if (activeIsTypstSource()) void addTypstLabel();
      else latexLabel();
    },
  });
  registerTypstPaletteCommands(palette);

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
    id: "palette.format-document",
    group: () => i18n.t(($) => $.shell.commandGroups.editor),
    label: () => i18n.t(($) => $.shell.commands.formatDocument.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.formatDocument.keywords)} ${ENGLISH_KEYWORDS.formatDocument}`,
    icon: () => <AlignLeft className="size-4" />,
    hint: () => shortcut("⇧⌥F"),
    order: 488,
    when: languageServiceFormattingAvailable,
    run: () => runLanguageServiceFormat("document"),
  });
  palette({
    id: "palette.format-selection",
    group: () => i18n.t(($) => $.shell.commandGroups.editor),
    label: () => i18n.t(($) => $.shell.commands.formatSelection.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.formatSelection.keywords)} ${ENGLISH_KEYWORDS.formatSelection}`,
    icon: () => <AlignLeft className="size-4" />,
    order: 489,
    when: languageServiceFormattingAvailable,
    run: () => runLanguageServiceFormat("selection"),
  });
  for (const entry of EDITOR_COMMAND_PALETTE) {
    palette({
      id: `palette.editor-${entry.id}`,
      group: () => i18n.t(($) => $.shell.commandGroups.editor),
      label: () => i18n.t(($) => $.settings.shortcuts.editorKeys.labels[entry.id]),
      keywords: () =>
        `${i18n.t(($) => $.shell.commands.editorCommands.keywords[entry.id])} ${EDITOR_COMMAND_KEYWORDS[entry.id]}`,
      icon: () => <entry.icon className="size-4" />,
      order: entry.order,
      run: () => {
        const view = getEditorView();
        if (!view) return;
        entry.run(view);
        view.focus();
      },
    });
  }
  palette({
    id: "palette.close-all-editor-tabs",
    group: () => i18n.t(($) => $.shell.commandGroups.editor),
    label: () => i18n.t(($) => $.shell.commands.closeAllEditorTabs.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.closeAllEditorTabs.keywords)} ${ENGLISH_KEYWORDS.closeAllEditorTabs}`,
    icon: () => <X className="size-4" />,
    order: 496,
    when: () => currentEditorTabs().length > 0,
    run: () => closeAllEditorTabs(),
  });
  palette({
    id: "palette.close-assistant-tabs",
    group: () => i18n.t(($) => $.shell.commandGroups.editor),
    label: () => i18n.t(($) => $.shell.commands.closeAssistantTabs.label),
    keywords: () =>
      `${i18n.t(($) => $.shell.commands.closeAssistantTabs.keywords)} ${ENGLISH_KEYWORDS.closeAssistantTabs}`,
    icon: () => <Sparkles className="size-4" />,
    order: 497,
    when: () => openAssistantTabs().length > 0,
    run: () => closeAssistantTabs(),
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

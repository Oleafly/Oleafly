import type { Extension } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import { lintGutter } from "@codemirror/lint";
import {
  CodeMirrorEditor as CodeMirrorEditorCore,
  type EditorHost,
  setSpellHost,
  setBibKeysProvider,
  bibKeysFromSources,
} from "@oleafly/editor";
import { createPreflightLinter } from "./cm/preflight-linter";
import { createCompileErrorLinter } from "./cm/compile-error-linter";
import { codeIntel } from "./cm/code-intel";
import { hoverIntel } from "./cm/hover-intel";
import { inlineDiffPlugin } from "./cm/inline-ai/plugin";
import { toggleInlineEdit } from "./cm/inline-ai/openSession";
import {
  projectCompletionSourcesForPath,
  projectIntelligenceExtensions,
} from "./cm/project-intelligence";
import {
  languageServiceCompletion,
  languageServiceEditorExtensions,
} from "./cm/language-service";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCompileStore } from "@/store/compile";
import { useDictionary, isWordIgnored, ignoreWordForProject, ignoreWordGlobally } from "@/lib/dictionary";
import { isSessionIgnoredWord } from "@/lib/proofreading/ignored";
import {
  cancelProofreading,
  proofreadDocument,
} from "@/lib/proofreading/client";
import { proofreadingPresentationDiagnostics } from "@/store/proofreading";

// Module side effect: must install before any lint runs.
setSpellHost({
  getProjectId: () => useFilesStore.getState().projectId,
  getActivePath: () => useFilesStore.getState().activePath,
  getLintPrefs: () => {
    const s = useSettingsStore.getState();
    return {
      showRegionalism: s.showRegionalism,
      showWordChoice: s.showWordChoice,
      dialect: s.grammarDialect,
    };
  },
  proofread: async (input) => {
    const dictionary = useDictionary.getState();
    const ignoredWords = [
      ...dictionary.global,
      ...(input.projectId
        ? (dictionary.ignored[input.projectId] ?? [])
        : []),
    ];
    const result = await proofreadDocument({
      identity: {
        projectId: input.projectId,
        path: input.path,
        revision: input.revision,
        surface: input.surface,
      },
      text: input.text,
      format: input.format,
      mode: input.mode,
      preferences: input.preferences,
      ignoredWords,
    });
    return {
      ...result,
      diagnostics: proofreadingPresentationDiagnostics(result),
    };
  },
  cancelProofreading,
  isSessionIgnored: isSessionIgnoredWord,
  isWordIgnored,
  ignoreWordForProject,
  ignoreWordGlobally,
});

setBibKeysProvider(() => {
  const files = useFilesStore.getState().files;
  const bibs = Object.entries(files)
    .filter(([path]) => path.endsWith(".bib"))
    .map(([, state]) => state.content);
  return bibKeysFromSources(bibs);
});

// Module-level so the host identity is stable across renders (its use* members are hooks).
const HOST: EditorHost = {
  useActivePath: () => useFilesStore((s) => s.activePath),
  getActivePath: () => useFilesStore.getState().activePath,
  useDocVersion: () => useFilesStore((s) => s.docVersion),
  getContent: (path) => useFilesStore.getState().files[path]?.content ?? "",
  setContent: (path, content) => useFilesStore.getState().setContent(path, content),
  useSettings: () => ({
    vim: useSettingsStore((s) => s.vim),
    spellcheck: useSettingsStore((s) => s.spellcheck),
    harper: useSettingsStore((s) => s.harper),
    editorTheme: useSettingsStore((s) => s.editorTheme),
  }),
  useLintRefreshDeps: () => [
    useSettingsStore((s) => s.showRegionalism),
    useSettingsStore((s) => s.showWordChoice),
    useDictionary((s) => s.global),
    useDictionary((s) => s.ignored),
    useCompileStore((s) => s.errors),
  ],
};

const LATEX_EXTENSIONS: Extension[] = [
  createPreflightLinter(),
  createCompileErrorLinter(),
];

const PROJECT_INTELLIGENCE_EXTENSIONS: Extension[] = [
  lintGutter(),
  codeIntel(),
  hoverIntel(),
  ...projectIntelligenceExtensions(),
  ...languageServiceEditorExtensions(),
];

const EXTRA_KEYMAP: KeyBinding[] = [
  { key: "Mod-l", run: (v) => { toggleInlineEdit(v); return true; } },
];

export function CodeMirrorEditor() {
  return (
    <CodeMirrorEditorCore
      host={HOST}
      extraExtensions={[inlineDiffPlugin]}
      extraExtensionsForPath={(path) => {
        if (!path || !/\.(?:tex|latex|ltx|sty|cls|md|markdown|typ|bib)$/i.test(path)) {
          return [];
        }
        return /\.(?:tex|latex|ltx|sty|cls)$/i.test(path)
          ? [...LATEX_EXTENSIONS, ...PROJECT_INTELLIGENCE_EXTENSIONS]
          : PROJECT_INTELLIGENCE_EXTENSIONS;
      }}
      extraCompletionSourcesForPath={(path) => [
        languageServiceCompletion,
        ...projectCompletionSourcesForPath(path),
      ]}
      extraKeymap={EXTRA_KEYMAP}
    />
  );
}

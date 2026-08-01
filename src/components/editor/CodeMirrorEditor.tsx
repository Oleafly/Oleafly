import { useEffect } from "react";
import type { Extension } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import {
  CodeMirrorEditor as CodeMirrorEditorCore,
  type EditorHost,
} from "@oleafly/editor/CodeMirrorEditor";
import {
  setSpellHost,
  setBibKeysProvider,
  bibKeysFromSources,
  latexListKeymap,
  latexStructureKeymap,
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
import { useIndexStore } from "@/store/project-index";
import { useSettingsStore } from "@/store/settings";
import { useCompileStore } from "@/store/compile";
import { useDictionary, isWordIgnored, ignoreWordForProject, ignoreWordGlobally } from "@/lib/dictionary";
import { installAuxNumbers } from "@/lib/aux-numbers";
import { installLatexCorpus } from "@/lib/latex-corpus";
import { isSessionIgnoredWord } from "@/lib/proofreading/ignored";
import {
  cancelProofreading,
  getRetainedProofreadingResult,
  proofreadDocument,
} from "@/lib/proofreading/client";
import { proofreadingPresentationDiagnostics } from "@/store/proofreading";

function sourceProofreadingContextKey(
  projectId: string | null,
): string {
  const settings = useSettingsStore.getState();
  const dictionary = useDictionary.getState();
  return JSON.stringify([
    settings.spellcheck,
    settings.harper,
    settings.grammarDialect,
    settings.dictionaryLocale,
    settings.showRegionalism,
    settings.showWordChoice,
    [...dictionary.global].sort(),
    projectId
      ? [...(dictionary.ignored[projectId] ?? [])].sort()
      : [],
  ]);
}

// Module side effect: must install before any lint runs.
setSpellHost({
  getProjectId: () => useFilesStore.getState().projectId,
  getActivePath: () => useFilesStore.getState().activePath,
  getProofreadingContextKey: sourceProofreadingContextKey,
  getLintPrefs: () => {
    const s = useSettingsStore.getState();
    return {
      showRegionalism: s.showRegionalism,
      showWordChoice: s.showWordChoice,
      dialect: s.grammarDialect,
    };
  },
  proofread: (input) => {
    const contextKey = sourceProofreadingContextKey(
      input.projectId,
    );
    const dictionary = useDictionary.getState();
    const ignoredWords = [
      ...dictionary.global,
      ...(input.projectId
        ? (dictionary.ignored[input.projectId] ?? [])
        : []),
    ];
    return proofreadDocument({
      cacheKey: contextKey,
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
  },
  getRetainedProofreading: (input) =>
    getRetainedProofreadingResult({
      cacheKey: input.contextKey,
      projectId: input.projectId,
      path: input.path,
      text: input.text,
      mode: input.mode,
      surface: "source",
    }),
  presentDiagnostics: proofreadingPresentationDiagnostics,
  cancelProofreading,
  isSessionIgnored: isSessionIgnoredWord,
  isWordIgnored,
  ignoreWordForProject,
  ignoreWordGlobally,
});

setBibKeysProvider(() => {
  const filesState = useFilesStore.getState();
  const bibs = Object.entries(filesState.files)
    .filter(([path]) => path.endsWith(".bib"))
    .map(([, state]) => state.content);
  const intelligence = useIndexStore.getState().intelligenceState;
  const retainedProjectKeys =
    intelligence.identity?.projectId === filesState.projectId
      ? (intelligence.data?.bibliography.entries.map(
          (entry) => entry.key,
        ) ?? [])
      : [];
  return [
    ...new Set([
      ...bibKeysFromSources(bibs),
      ...retainedProjectKeys,
    ]),
  ];
});

installLatexCorpus();
installAuxNumbers();

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
  codeIntel(),
  hoverIntel(),
  ...projectIntelligenceExtensions(),
  ...languageServiceEditorExtensions(),
];

const EXTRA_KEYMAP: KeyBinding[] = [
  // List keymap first so its Enter binding is checked before defaults.
  ...latexListKeymap,
  ...latexStructureKeymap,
  { key: "Mod-l", run: (v) => { toggleInlineEdit(v); return true; } },
];

export function CodeMirrorEditor({ active = true }: { active?: boolean }) {
  useEffect(
    () =>
      useSettingsStore.subscribe((settings, previous) => {
        const disabled =
          !settings.spellcheck && !settings.harper;
        const wasEnabled =
          previous.spellcheck || previous.harper;
        if (!disabled || !wasEnabled) return;
        // This transition removes the final proofreading provider. Clear both
        // surfaces synchronously with the settings store update so a completed
        // worker generation cannot remain visible while React reconfigures
        // the Source and Visual editors.
        cancelProofreading("source");
        cancelProofreading("visual");
      }),
    [],
  );

  return (
    <CodeMirrorEditorCore
      active={active}
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

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
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCompileStore } from "@/store/compile";
import { useDictionary, isWordIgnored, ignoreWordForProject, ignoreWordGlobally } from "@/lib/dictionary";
import { getSpellchecker, isIgnored } from "@/lib/spellcheck";
import { lintGrammar } from "@/lib/harper";

// Module side effect: must install before any lint runs.
setSpellHost({
  getProjectId: () => useFilesStore.getState().projectId,
  getActivePath: () => useFilesStore.getState().activePath,
  getLintPrefs: () => {
    const s = useSettingsStore.getState();
    return { showRegionalism: s.showRegionalism, showWordChoice: s.showWordChoice };
  },
  getSpellchecker,
  isSessionIgnored: isIgnored,
  isWordIgnored,
  ignoreWordForProject,
  ignoreWordGlobally,
  lintGrammar,
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
  lintGutter(),
  createPreflightLinter(),
  createCompileErrorLinter(),
  codeIntel(),
  hoverIntel(),
];

const EXTRA_KEYMAP: KeyBinding[] = [
  { key: "Mod-l", run: (v) => { toggleInlineEdit(v); return true; } },
];

export function CodeMirrorEditor() {
  return (
    <CodeMirrorEditorCore
      host={HOST}
      extraExtensions={[inlineDiffPlugin]}
      extraExtensionsForPath={(path) =>
        path && /\.(?:tex|latex|ltx)$/i.test(path) ? LATEX_EXTENSIONS : []
      }
      extraKeymap={EXTRA_KEYMAP}
    />
  );
}

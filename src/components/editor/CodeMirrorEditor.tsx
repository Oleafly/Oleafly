import type { Extension } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import {
  CodeMirrorEditor as CodeMirrorEditorCore,
  type EditorHost,
  setSpellHost,
  setBibKeysProvider,
  bibKeysFromSources,
} from "@openleaf/editor";
import { createPreflightLinter } from "./cm/preflight-linter";
import { codeIntel } from "./cm/code-intel";
import { hoverIntel } from "./cm/hover-intel";
import { inlineDiffPlugin } from "./cm/inline-ai/plugin";
import { toggleInlineEdit } from "./cm/inline-ai/openSession";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useDictionary, isWordIgnored, ignoreWordForProject, ignoreWordGlobally } from "@/lib/dictionary";
import { getSpellchecker, isIgnored } from "@/lib/spellcheck";
import { lintGrammar } from "@/lib/harper";

// Wire the package's spelling/grammar linters to the app's engines, ignore
// dictionary, and settings (module side effect: installed before any lint runs).
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

// \cite completion keys come from the project's loaded .bib files.
setBibKeysProvider(() => {
  const files = useFilesStore.getState().files;
  const bibs = Object.entries(files)
    .filter(([path]) => path.endsWith(".bib"))
    .map(([, state]) => state.content);
  return bibKeysFromSources(bibs);
});

/** Document model + settings port over the app stores. Module-level so the
 *  host identity is stable across renders (its use* members are hooks). */
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
  ],
};

// App feature extensions: preflight lint, code/hover intel, inline AI editing.
const EXTRA_EXTENSIONS: Extension[] = [
  createPreflightLinter(),
  codeIntel(),
  hoverIntel(),
  inlineDiffPlugin,
];

const EXTRA_KEYMAP: KeyBinding[] = [
  { key: "Mod-l", run: (v) => { toggleInlineEdit(v); return true; } },
];

/** Thin app wrapper: wires the app stores and feature plugins into the
 *  package's editor. */
export function CodeMirrorEditor() {
  return (
    <CodeMirrorEditorCore
      host={HOST}
      extraExtensions={EXTRA_EXTENSIONS}
      extraKeymap={EXTRA_KEYMAP}
    />
  );
}

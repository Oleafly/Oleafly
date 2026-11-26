import { loadSnippetRuntime, type SnippetPort, type SnippetSwitches } from "@oleafly/editor";
import { readClipboardText } from "@/lib/clipboard";
import { logError } from "@/lib/log";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { snippetLanguageForPath } from "./language";
import { openSnippetSettings } from "./open-settings";
import { useSnippetStore, watchSnippetFiles } from "./store";

type PortServices = typeof import("./port-services");

const TYPST_VERSION = /^(\d+)\.(\d+)/u;

let started = false;
let services: PortServices | null = null;

function logLoadFailure(error: unknown): void {
  void logError("load snippets", error);
}

function startSnippets(): void {
  if (started) return;
  started = true;
  useSnippetStore.getState().load().catch(logLoadFailure);
  watchSnippetFiles();
  import("./port-services").then((loaded) => {
    services = loaded;
  }, logLoadFailure);
  loadSnippetRuntime().catch(logLoadFailure);
}

function switches(): SnippetSwitches {
  const settings = useSettingsStore.getState();
  return { list: settings.snippetsInList, tab: settings.snippetsTab, auto: settings.snippetsAuto, hint: settings.snippetsHint };
}

function typstVersion(): [number, number] | undefined {
  const match = TYPST_VERSION.exec(useFilesStore.getState().engine.typst_resolved?.version?.trim() ?? "");
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

export function createSnippetPort(getPath: () => string | null): SnippetPort {
  startSnippets();
  const language = () => snippetLanguageForPath(getPath());
  return {
    library: () => useSnippetStore.getState().library,
    language,
    filePath: getPath,
    projectName: () => useFilesStore.getState().projectName || null,
    typstVersion,
    enabled: switches,
    projectItems: (kind) => services?.projectItems(kind) ?? [],
    useCount: (id) => useSnippetStore.getState().useCounts[id] ?? 0,
    recordUse: (id) => useSnippetStore.getState().recordUse(id),
    readClipboard: readClipboardText,
    renderMathPreview: (source, mathLanguage) => services?.renderSnippetMath(source, mathLanguage) ?? null,
    editSnippet: (id) => openSnippetSettings(id),
    collectionName: (collection) => services?.snippetCollectionName(collection) ?? null,
    onAutoExpanded: (record) => services?.noteAutoExpansion(record),
    onHandTypedFraction: () => services?.offerFastMath(language()),
    reportSlowRegex: (record) => {
      useSnippetStore
        .getState()
        .disableRegex(record.id)
        .catch((error: unknown) => logError("switch off a slow snippet trigger", error));
    },
  };
}

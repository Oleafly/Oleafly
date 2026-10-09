import { logError } from "@/lib/log";
import { setDefaultLatexEngineCmd } from "@/lib/tauri";
import { useSettingsStore, type DefaultLatexEngine } from "@/store/settings";

function pushDefaultLatexEngine(engine: DefaultLatexEngine): void {
  setDefaultLatexEngineCmd(engine).catch((error: unknown) => {
    void logError("set the default compile engine", error);
  });
}

export function startDefaultLatexEngineSync(): Promise<() => void> {
  const stop = useSettingsStore.subscribe((state, previous) => {
    if (state.defaultLatexEngine !== previous.defaultLatexEngine) {
      pushDefaultLatexEngine(state.defaultLatexEngine);
    }
  });
  pushDefaultLatexEngine(useSettingsStore.getState().defaultLatexEngine);
  return Promise.resolve(stop);
}

import { i18n } from "@/i18n";
import { installPhaseLabel, type InstallPhase } from "@/store/engine";

export function tinytexActionLabel(
  state: Readonly<{
    installing: boolean;
    installPhase: InstallPhase | null;
    progress: number | null;
    partialDownloadBytes: number;
  }>,
): string {
  if (state.installing) return installPhaseLabel(state.installPhase, state.progress);
  if (state.partialDownloadBytes > 0) {
    return i18n.t(($) => $.shell.enginePicker.tinytex.resume, {
      megabytes: Math.round(state.partialDownloadBytes / 1_000_000),
    });
  }
  return i18n.t(($) => $.shell.enginePicker.tinytex.download);
}

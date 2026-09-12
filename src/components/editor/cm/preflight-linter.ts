import { linter, type Diagnostic } from "@codemirror/lint";
import { runSourceRules } from "@oleafly/preflight";
import { preflightDetail, preflightMessage } from "@/components/preflight/message";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";

// Only findings that map to a source range are shown here; whole-document and
// PDF findings live in the Preflight panel instead.
export function createPreflightLinter() {
  return linter(
    (view): Diagnostic[] => {
      if (useFilesStore.getState().engine.capabilities.source_preflight_profile !== "latex") return [];
      const diags: Diagnostic[] = [];
      for (const f of runSourceRules(view.state.doc.toString())) {
        if (typeof f.from !== "number" || typeof f.to !== "number") continue;
        diags.push({
          from: f.from,
          to: f.to,
          severity: f.severity,
          message: i18n.t(($) => $.intelligence.diagnostics.finding, {
            title: preflightMessage(f.title),
            detail: preflightDetail(f),
          }),
          source: "preflight",
        });
      }
      return diags;
    },
    {
      delay: 900,
      // Diagnostics render through the shared hover card, so the stock lint
      // tooltip must not also appear.
      tooltipFilter: () => [],
    },
  );
}

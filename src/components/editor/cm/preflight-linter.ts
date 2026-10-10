import { linter, type Diagnostic } from "@codemirror/lint";
import { requestsTaggedPdf, runSourceRules, type Finding } from "@oleafly/preflight";
import { preflightDetail, preflightMessage } from "@/components/preflight/message";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

export type PreflightSourceLanguage = "latex" | "typst";

// Only findings that map to a source range are shown here; whole-document and
// PDF findings live in the Preflight panel instead.
function toDiagnostics(findings: readonly Finding[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const f of findings) {
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
}

function latexDocumentIsTagged(text: string): boolean {
  if (requestsTaggedPdf(text)) return true;
  const { mainDoc, files } = useFilesStore.getState();
  const mainText = mainDoc ? (files[mainDoc]?.content ?? useIndexStore.getState().texts[mainDoc]) : undefined;
  return mainText !== undefined && requestsTaggedPdf(mainText);
}

function latexEditorFindings(text: string): Finding[] {
  const findings = runSourceRules(text);
  if (!findings.some((finding) => finding.id === "figure-alt") || latexDocumentIsTagged(text)) {
    return findings;
  }
  return findings.filter((finding) => finding.id !== "figure-alt");
}

export function preflightDiagnostics(
  text: string,
  language: PreflightSourceLanguage,
): Diagnostic[] | Promise<Diagnostic[]> {
  if (useFilesStore.getState().engine.capabilities.source_preflight_profile !== language) return [];
  if (language === "latex") return toDiagnostics(latexEditorFindings(text));
  return import("@/store/preflight-typst").then(({ typstEditorFindings }) =>
    toDiagnostics(typstEditorFindings(text, useFilesStore.getState().engine)),
  );
}

export function createPreflightLinter(language: PreflightSourceLanguage = "latex") {
  return linter(
    (view) => preflightDiagnostics(view.state.doc.toString(), language),
    {
      delay: 900,
      // Diagnostics render through the shared hover card, so the stock lint
      // tooltip must not also appear.
      tooltipFilter: () => [],
    },
  );
}

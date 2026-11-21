import { linter, type Action, type Diagnostic } from "@codemirror/lint";
import { message, requestsTaggedPdf, runSourceRules, type Finding } from "@oleafly/preflight";
import type { WritingSettings } from "@oleafly/preflight/writing/settings";
import { preflightDetail, preflightMessage } from "@/components/preflight/message";
import { ignoreWritingFinding } from "@/features/writing-fixes";
import { i18n } from "@/i18n";
import { notifyError } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

export type PreflightSourceLanguage = "latex" | "typst";

const LATEX_SOURCE = /\.(?:tex|ltx|sty|cls)$/i;

function fixAction(finding: Finding): Action | null {
  const fix = finding.fix;
  const anchor = finding.from;
  if (!fix || anchor === undefined || (fix.otherFiles?.length ?? 0) > 0) return null;
  return {
    name: preflightMessage(fix.label),
    apply: (view, from) => {
      if (view.state.readOnly) return;
      const shift = from - anchor;
      const changes = [...fix.edits]
        .sort((left, right) => left.from - right.from)
        .map((edit) => ({ from: edit.from + shift, to: edit.to + shift, insert: edit.insert }));
      if (changes.some((change) => change.from < 0 || change.to > view.state.doc.length)) return;
      view.dispatch({ changes });
    },
  };
}

function ignoreAction(finding: Finding): Action | null {
  if (!finding.fingerprint) return null;
  return {
    name: preflightMessage(message("finding.ignore")),
    apply: () => {
      ignoreWritingFinding(finding).catch((error) => notifyError("ignore writing finding", error));
    },
  };
}

function writingActions(finding: Finding): Action[] {
  if (finding.lens !== "writing") return [];
  return [fixAction(finding), ignoreAction(finding)].filter((action): action is Action => action !== null);
}

function toDiagnostics(findings: readonly Finding[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const f of findings) {
    if (typeof f.from !== "number" || typeof f.to !== "number") continue;
    const actions = writingActions(f);
    diags.push({
      from: f.from,
      to: f.to,
      severity: f.severity,
      message: i18n.t(($) => $.intelligence.diagnostics.finding, {
        title: preflightMessage(f.title),
        detail: preflightDetail(f),
      }),
      source: "preflight",
      ...(actions.length > 0 ? { actions } : {}),
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

type WritingModule = typeof import("@oleafly/preflight/writing");
type WritingContext = import("@oleafly/preflight/writing").WritingContext;

let projectContextCache: {
  texts: Record<string, string>;
  settings: WritingSettings;
  context: WritingContext;
} | null = null;

function editorWritingContext(writing: WritingModule): WritingContext {
  const settings = useFilesStore.getState().projectWritingSettings;
  const texts = useIndexStore.getState().texts;
  if (projectContextCache?.texts !== texts || projectContextCache.settings !== settings) {
    const sources = Object.entries(texts)
      .filter(([path]) => LATEX_SOURCE.test(path))
      .map(([, content]) => content);
    projectContextCache = {
      texts,
      settings,
      context: sources.length > 0 ? { settings, ...writing.writingContextFor(sources, settings) } : { settings },
    };
  }
  return projectContextCache.context;
}

function latexSourceFindings(text: string): Finding[] {
  const source = runSourceRules(text);
  return !source.some((finding) => finding.id === "figure-alt") || latexDocumentIsTagged(text)
    ? source
    : source.filter((finding) => finding.id !== "figure-alt");
}

function latexEditorDiagnostics(text: string): Diagnostic[] | Promise<Diagnostic[]> {
  const findings = latexSourceFindings(text);
  if (!useFilesStore.getState().projectWritingSettings.underlines) return toDiagnostics(findings);
  return import("@oleafly/preflight/writing").then((writing) =>
    toDiagnostics([...findings, ...writing.runWritingRules(text, editorWritingContext(writing))]),
  );
}

export function preflightDiagnostics(
  text: string,
  language: PreflightSourceLanguage,
): Diagnostic[] | Promise<Diagnostic[]> {
  if (useFilesStore.getState().engine.capabilities.source_preflight_profile !== language) return [];
  if (language === "latex") return latexEditorDiagnostics(text);
  return import("@/store/preflight-typst").then(({ typstEditorFindings }) =>
    toDiagnostics(typstEditorFindings(text, useFilesStore.getState().engine)),
  );
}

export function createPreflightLinter(language: PreflightSourceLanguage = "latex") {
  return linter(
    (view) => preflightDiagnostics(view.state.doc.toString(), language),
    {
      delay: 900,
      tooltipFilter: () => [],
    },
  );
}

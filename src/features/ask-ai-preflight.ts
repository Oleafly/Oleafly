import type { Finding } from "@oleafly/preflight";
import {
  ensureAiProviderOrOpenSettings,
  handoffToAssistant,
} from "@/features/assistant-handoff";
import { preflightDetailInEnglish, preflightMessageInEnglish } from "@/components/preflight/message";

function severityLabel(severity: Finding["severity"]): string {
  if (severity === "error") return "Error";
  if (severity === "warning") return "Warning";
  return "Note";
}

function describeFinding(finding: Finding): string {
  const sev = severityLabel(finding.severity);
  const pageSuffix = finding.page != null ? `, p.${finding.page}` : "";
  const pageOnly = finding.page != null ? ` (p.${finding.page})` : "";
  const where = finding.file ? ` (${finding.file}${pageSuffix})` : pageOnly;
  return `- [${sev}] ${preflightMessageInEnglish(finding.title)}${where}\n  ${preflightDetailInEnglish(finding)}`;
}

export async function askAiAboutFinding(finding: Finding) {
  if (!(await ensureAiProviderOrOpenSettings())) return;
  const prompt = [
    "Fix this preflight finding in the current document.",
    "",
    describeFinding(finding),
    "",
    "Inspect the relevant project files, make the smallest correct change that resolves it, then re-run the affected preflight check to verify.",
  ].join("\n");
  handoffToAssistant(prompt, { autoSend: false });
}

export async function askAiAboutFindings(findings: Finding[]) {
  if (findings.length === 0) return;
  if (findings.length === 1) return askAiAboutFinding(findings[0]);
  if (!(await ensureAiProviderOrOpenSettings())) return;
  const prompt = [
    "Fix the following preflight findings in the current document.",
    "",
    findings.map(describeFinding).join("\n"),
    "",
    "Work through them, inspect the relevant project files, make the smallest correct changes, then re-run preflight to verify each is resolved.",
  ].join("\n");
  handoffToAssistant(prompt, { autoSend: false });
}

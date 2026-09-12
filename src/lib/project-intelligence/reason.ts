import { i18n } from "@/i18n";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import type {
  ProjectDiagnosticMessage,
  ProjectIntelligenceReason,
  ProjectIntelligenceState,
} from "./types";

type ProjectDiagnosticKind = keyof typeof enCore.projectDiagnostics.kinds;

function isProjectDiagnosticKind(value: string): value is ProjectDiagnosticKind {
  return value in enCore.projectDiagnostics.kinds;
}

export function projectIntelligenceReasonText(
  reason: ProjectIntelligenceReason | undefined,
): string | undefined {
  if (!reason) return undefined;
  return i18n.t(($) => $.core.intelligence[reason.key], reason.params);
}

export function projectIntelligenceFailureText(
  state: Pick<ProjectIntelligenceState, "failure" | "reason">,
): string | undefined {
  return (
    projectIntelligenceReasonText(state.failure?.reason) ??
    state.failure?.message ??
    projectIntelligenceReasonText(state.reason)
  );
}

export function projectDiagnosticText(message: ProjectDiagnosticMessage): string {
  const params = message.params;
  if (!params) return i18n.t(($) => $.core.projectDiagnostics[message.key]);
  const kind = params.kind;
  const resolved =
    typeof kind === "string" && isProjectDiagnosticKind(kind)
      ? { ...params, kind: i18n.t(($) => $.core.projectDiagnostics.kinds[kind]) }
      : params;
  return String(i18n.t(($) => $.core.projectDiagnostics[message.key], resolved));
}

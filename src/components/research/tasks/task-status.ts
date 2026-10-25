import {
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  CircleSlash,
  FlaskConical,
  Loader2,
  XCircle,
} from "lucide-react";
import type { BadgeVariant } from "@/components/ui/badge";
import { i18n } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";
import type { ApprovalStatus, ResearchTaskStatus, RunState, TaskPhase } from "@/lib/research-tasks";

export function statusLabel(status: ResearchTaskStatus): string {
  switch (status) {
    case "queued":
      return i18n.t(($) => $.researchTools.tasks.status.queued);
    case "running":
      return i18n.t(($) => $.researchTools.tasks.status.running);
    case "awaiting_review":
      return i18n.t(($) => $.researchTools.tasks.status.awaitingReview);
    case "completed":
      return i18n.t(($) => $.researchTools.tasks.status.completed);
    case "failed":
      return i18n.t(($) => $.researchTools.tasks.status.failed);
    case "cancelled":
      return i18n.t(($) => $.researchTools.tasks.status.cancelled);
    case "plan_ready":
      return i18n.t(($) => $.researchTools.tasks.status.planReady);
  }
}

export const STATUS_ICONS: Record<ResearchTaskStatus, typeof CircleDashed> = {
  queued: CircleDashed,
  running: Loader2,
  awaiting_review: FlaskConical,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
  plan_ready: ClipboardCheck,
};

const STATUS_BADGES: Record<ResearchTaskStatus, BadgeVariant> = {
  queued: "muted",
  running: "primaryGhost",
  awaiting_review: "warning",
  completed: "success",
  failed: "destructive",
  cancelled: "warning",
  plan_ready: "warning",
};

const STATUS_DOTS: Record<ResearchTaskStatus, string> = {
  queued: "bg-muted-foreground/50",
  running: "bg-primary",
  awaiting_review: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-amber-500",
  plan_ready: "bg-amber-500",
};

/** The `Badge` tone of a task status. */
export function statusBadgeVariant(status: ResearchTaskStatus): BadgeVariant {
  return STATUS_BADGES[status];
}

export function statusDotClass(status: ResearchTaskStatus): string {
  return STATUS_DOTS[status];
}

export function relativeTime(value: number): string {
  return formatRelativeTimeFrom(value, Date.now(), {
    largestUnit: "day",
    justNow: i18n.t(($) => $.researchTools.tasks.relative.justNow),
    format: ({ unit, value: count }) => {
      if (unit === "minute") return i18n.t(($) => $.researchTools.tasks.relative.minutes, { minutes: count });
      if (unit === "hour") return i18n.t(($) => $.researchTools.tasks.relative.hours, { hours: count });
      return i18n.t(($) => $.researchTools.tasks.relative.days, { days: count });
    },
  });
}

export function runStateLabel(state: RunState): string {
  switch (state) {
    case "starting":
      return i18n.t(($) => $.researchTools.runs.status.starting);
    case "running":
      return i18n.t(($) => $.researchTools.runs.status.running);
    case "succeeded":
      return i18n.t(($) => $.researchTools.runs.status.succeeded);
    case "failed":
      return i18n.t(($) => $.researchTools.runs.status.failed);
    case "timed_out":
      return i18n.t(($) => $.researchTools.runs.status.timedOut);
    case "cancelled":
      return i18n.t(($) => $.researchTools.runs.status.cancelled);
    case "lost":
      return i18n.t(($) => $.researchTools.runs.status.lost);
  }
}

export function approvalStatusLabel(status: Exclude<ApprovalStatus, "pending">): string {
  switch (status) {
    case "approved":
      return i18n.t(($) => $.researchTools.tasks.approvals.status.approved);
    case "denied":
      return i18n.t(($) => $.researchTools.tasks.approvals.status.denied);
    case "expired":
      return i18n.t(($) => $.researchTools.tasks.approvals.status.expired);
    case "withdrawn":
      return i18n.t(($) => $.researchTools.tasks.approvals.status.withdrawn);
  }
}

export function phaseLabel(phase: TaskPhase): string {
  switch (phase) {
    case "preparing":
      return i18n.t(($) => $.researchTools.tasks.phase.preparing);
    case "planning":
      return i18n.t(($) => $.researchTools.tasks.phase.planning);
    case "working":
      return i18n.t(($) => $.researchTools.tasks.phase.working);
    case "waiting_runs":
      return i18n.t(($) => $.researchTools.tasks.phase.waitingRuns);
    case "waiting_approval":
      return i18n.t(($) => $.researchTools.tasks.phase.waitingApproval);
    case "wrapping_up":
      return i18n.t(($) => $.researchTools.tasks.phase.wrappingUp);
    case "checking_evidence":
      return i18n.t(($) => $.researchTools.tasks.phase.checkingEvidence);
  }
}

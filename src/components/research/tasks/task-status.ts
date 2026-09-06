import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  FlaskConical,
  Loader2,
  XCircle,
} from "lucide-react";
import type { ResearchTaskStatus } from "@/lib/research-tasks";

export const STATUS_LABELS: Record<ResearchTaskStatus, string> = {
  queued: "Queued",
  running: "Running",
  awaiting_review: "Review needed",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const STATUS_ICONS: Record<ResearchTaskStatus, typeof CircleDashed> = {
  queued: CircleDashed,
  running: Loader2,
  awaiting_review: FlaskConical,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
};

const STATUS_BADGES: Record<ResearchTaskStatus, string> = {
  queued: "border-border bg-muted text-muted-foreground",
  running: "border-primary/30 bg-primary/10 text-primary",
  awaiting_review: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelled: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

const STATUS_DOTS: Record<ResearchTaskStatus, string> = {
  queued: "bg-muted-foreground/50",
  running: "bg-primary",
  awaiting_review: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-amber-500",
};

export function statusBadgeClass(status: ResearchTaskStatus): string {
  return STATUS_BADGES[status];
}

export function statusDotClass(status: ResearchTaskStatus): string {
  return STATUS_DOTS[status];
}

export function relativeTime(value: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

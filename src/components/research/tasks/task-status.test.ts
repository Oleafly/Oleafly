import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClipboardCheck } from "lucide-react";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import {
  approvalStatusLabel,
  phaseLabel,
  relativeTime,
  runStateLabel,
  STATUS_ICONS,
  statusBadgeClass,
  statusDotClass,
  statusLabel,
} from "./task-status";

const relative = enResearchTools.tasks.relative;
const NOW = Date.UTC(2026, 9, 2, 12);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("relativeTime", () => {
  it("says just now under a minute and for a time in the future", () => {
    expect(relativeTime(NOW)).toBe(relative.justNow);
    expect(relativeTime(NOW - 30_000)).toBe(relative.justNow);
    expect(relativeTime(NOW + 5 * MINUTE)).toBe(relative.justNow);
  });

  it("counts minutes, then hours, then days", () => {
    expect(relativeTime(NOW - 5 * MINUTE)).toBe(relative.minutes.replace("{{minutes}}", "5"));
    expect(relativeTime(NOW - 3 * HOUR)).toBe(relative.hours.replace("{{hours}}", "3"));
    expect(relativeTime(NOW - 2 * DAY)).toBe(relative.days.replace("{{days}}", "2"));
    expect(relativeTime(NOW - 40 * DAY)).toBe(relative.days.replace("{{days}}", "40"));
  });

  it("counts whole units elapsed instead of rounding up", () => {
    expect(relativeTime(NOW - 90_000)).toBe(relative.minutes.replace("{{minutes}}", "1"));
    expect(relativeTime(NOW - (59 * MINUTE + 59_000))).toBe(relative.minutes.replace("{{minutes}}", "59"));
    expect(relativeTime(NOW - 36 * HOUR)).toBe(relative.days.replace("{{days}}", "1"));
  });
});

describe("task status labels", () => {
  const tasks = enResearchTools.tasks;

  it("names every task status, including a plan waiting for approval", () => {
    expect(statusLabel("queued")).toBe(tasks.status.queued);
    expect(statusLabel("running")).toBe(tasks.status.running);
    expect(statusLabel("awaiting_review")).toBe(tasks.status.awaitingReview);
    expect(statusLabel("completed")).toBe(tasks.status.completed);
    expect(statusLabel("failed")).toBe(tasks.status.failed);
    expect(statusLabel("cancelled")).toBe(tasks.status.cancelled);
    expect(statusLabel("plan_ready")).toBe("Plan ready");
  });

  it("shows a ready plan with the clipboard icon and the amber review colours", () => {
    expect(STATUS_ICONS.plan_ready).toBe(ClipboardCheck);
    expect(statusBadgeClass("plan_ready")).toBe(statusBadgeClass("awaiting_review"));
    expect(statusDotClass("plan_ready")).toBe(statusDotClass("awaiting_review"));
  });

  it("names every run state", () => {
    const runs = enResearchTools.runs.status;
    expect(runStateLabel("starting")).toBe(runs.starting);
    expect(runStateLabel("running")).toBe(runs.running);
    expect(runStateLabel("succeeded")).toBe("Finished");
    expect(runStateLabel("failed")).toBe(runs.failed);
    expect(runStateLabel("timed_out")).toBe("Timed out");
    expect(runStateLabel("cancelled")).toBe("Stopped");
    expect(runStateLabel("lost")).toBe(runs.lost);
  });

  it("names every answered approval", () => {
    const approvals = tasks.approvals.status;
    expect(approvalStatusLabel("approved")).toBe(approvals.approved);
    expect(approvalStatusLabel("denied")).toBe(approvals.denied);
    expect(approvalStatusLabel("expired")).toBe(approvals.expired);
    expect(approvalStatusLabel("withdrawn")).toBe(approvals.withdrawn);
  });

  it("names every phase of a running task", () => {
    expect(phaseLabel("preparing")).toBe("Preparing the workspace");
    expect(phaseLabel("planning")).toBe("Writing the plan");
    expect(phaseLabel("working")).toBe(tasks.phase.working);
    expect(phaseLabel("waiting_runs")).toBe("Waiting for runs");
    expect(phaseLabel("waiting_approval")).toBe("Waiting for approval");
    expect(phaseLabel("wrapping_up")).toBe(tasks.phase.wrappingUp);
    expect(phaseLabel("checking_evidence")).toBe("Checking evidence");
  });
});

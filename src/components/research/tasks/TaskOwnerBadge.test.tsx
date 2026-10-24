// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { ownerBadgeState, TaskOwnerBadge } from "./TaskChips";

const copy = enResearchTools.backgroundHelper.badge;

afterEach(() => cleanup());

describe("TaskOwnerBadge", () => {
  it("shows In background for a helper-owned running task", () => {
    render(<TaskOwnerBadge task={{ owner: "daemon", status: "running", reclaimRequested: false }} />);
    expect(screen.getByText(copy.background)).toBeTruthy();
    expect(screen.getByTestId("task-owner-badge").getAttribute("data-state")).toBe("background");
  });

  it("shows In background for a helper task that waits to start", () => {
    render(<TaskOwnerBadge task={{ owner: "daemon", status: "queued", reclaimRequested: false }} />);
    expect(screen.getByText(copy.background)).toBeTruthy();
  });

  it("shows Moving back while a reclaim is pending", () => {
    render(<TaskOwnerBadge task={{ owner: "daemon", status: "running", reclaimRequested: true }} />);
    expect(screen.getByText(copy.movingBack)).toBeTruthy();
    expect(screen.queryByText(copy.background)).toBeNull();
  });

  it("shows nothing for app-owned work", () => {
    const { container } = render(
      <TaskOwnerBadge task={{ owner: "app", status: "running", reclaimRequested: false }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing once the helper finished the task", () => {
    expect(ownerBadgeState({ owner: "daemon", status: "awaiting_review", reclaimRequested: false })).toBeNull();
    expect(ownerBadgeState({ owner: "app", status: "queued", reclaimRequested: false })).toBeNull();
    expect(ownerBadgeState({ owner: "app", status: "running", reclaimRequested: true })).toBe("movingBack");
  });
});

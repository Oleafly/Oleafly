// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { SkillSharePeerAgent, SkillShareTarget } from "@/lib/tauri";
import { SkillShareCard } from "./SkillShareCard";

const mocks = vi.hoisted(() => ({
  skillsShareTargets: vi.fn(),
  skillsShareSync: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  skillsShareTargets: mocks.skillsShareTargets,
  skillsShareSync: mocks.skillsShareSync,
}));

const copy = enSettings.ai.skills.share;

function target(agent: SkillSharePeerAgent, overrides: Partial<SkillShareTarget> = {}): SkillShareTarget {
  return {
    agent,
    label: agent,
    root: `~/.${agent}`,
    detected: true,
    linked: 2,
    total: 2,
    supported: true,
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.skillsShareTargets.mockReset();
  mocks.skillsShareSync.mockReset();
});

describe("SkillShareCard", () => {
  it("names agents it cannot reach and turns sharing back on after a failed sync", async () => {
    mocks.skillsShareTargets.mockResolvedValue([
      target("codex"),
      target("gemini", { detected: false, linked: 0 }),
      target("cursor", { supported: false, linked: 0 }),
    ]);
    mocks.skillsShareSync.mockRejectedValue(new Error("Permission denied"));
    render(<SkillShareCard />);

    const toggle = await screen.findByTestId("skills-share-toggle");
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("skills-share-summary")).toHaveTextContent("1 of 3 agents linked");
    fireEvent.click(screen.getByTestId("skills-share-card-toggle"));
    expect(screen.getByTestId("skills-share-target-gemini")).toHaveTextContent(copy.status.undetected);
    expect(screen.getByTestId("skills-share-target-cursor")).toHaveTextContent(copy.status.unsupported);

    fireEvent.click(toggle);

    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("says when there are no other agents and when they cannot be listed", async () => {
    mocks.skillsShareTargets.mockResolvedValueOnce([]);
    const { unmount } = render(<SkillShareCard />);
    expect(await screen.findByText(copy.summary.none)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("skills-share-card-toggle"));
    expect(screen.getByText(copy.emptyBody)).toBeInTheDocument();
    unmount();

    mocks.skillsShareTargets.mockRejectedValueOnce(new Error("Home folder is unreadable"));
    render(<SkillShareCard />);
    fireEvent.click(screen.getByTestId("skills-share-card-toggle"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Home folder is unreadable");
    expect(screen.getByTestId("skills-share-toggle")).toBeDisabled();
  });
});

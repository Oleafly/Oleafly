// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { agentLimitsGet, agentLimitsSet, type AgentLimits } from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import { AgentLimitsSection } from "./AgentLimits";

vi.mock("@/lib/tauri", () => ({
  agentLimitsGet: vi.fn(),
  agentLimitsSet: vi.fn(),
}));

const mockGet = vi.mocked(agentLimitsGet);
const mockSet = vi.mocked(agentLimitsSet);
const limits = enSettings.ai.limits;
const none: AgentLimits = { max_steps: null, max_output_tokens: null, turn_tokens: null };

async function renderSection() {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <AgentLimitsSection />
    </QueryClientProvider>,
  );
  const steps = await screen.findByLabelText(limits.stepsLabel);
  await waitFor(() => expect(steps).toBeEnabled());
  return steps;
}

describe("AgentLimitsSection", () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue(none);
    mockSet.mockReset().mockImplementation((next) => Promise.resolve(next));
  });

  it("shows each limit empty with the default it falls back to", async () => {
    const steps = await renderSection();

    expect(steps).toHaveValue(null);
    expect(steps).toHaveAttribute("placeholder", "50");
    expect(screen.getByLabelText(limits.outputLabel)).toHaveAttribute("placeholder", limits.modelDefault);
    expect(screen.getByLabelText(limits.turnTokensLabel)).toHaveAttribute("placeholder", limits.noLimit);
    expect(screen.getByLabelText(limits.turnTokensLabel)).toHaveAccessibleDescription(limits.turnTokensHint);
    expect(screen.getByRole("button", { name: limits.save })).toBeDisabled();
  });

  it("saves the edited limits as numbers through their own command", async () => {
    const user = userEvent.setup();
    await user.type(await renderSection(), "500");
    await user.type(screen.getByLabelText(limits.turnTokensLabel), "2000000");
    await user.click(screen.getByRole("button", { name: limits.save }));

    expect(mockSet).toHaveBeenCalledWith({ max_steps: 500, max_output_tokens: null, turn_tokens: 2_000_000 });
    expect(await screen.findByText(limits.saved)).toBeInTheDocument();
    expect(screen.getByLabelText(limits.stepsLabel)).toHaveValue(500);
  });

  it("names the field and its range when a value is out of range, and saves nothing", async () => {
    const user = userEvent.setup();
    await renderSection();

    await user.type(screen.getByLabelText(limits.outputLabel), "100");
    await user.click(screen.getByRole("button", { name: limits.save }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      limits.rangeError
        .replace("{{field}}", limits.outputLabel)
        .replace("{{min}}", "1,024")
        .replace("{{max}}", "1,048,576"),
    );
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("clears a stored limit back to its default", async () => {
    mockGet.mockResolvedValue({ ...none, max_steps: 200 });
    const user = userEvent.setup();
    const steps = await renderSection();

    expect(steps).toHaveValue(200);
    await user.clear(steps);
    await user.click(screen.getByRole("button", { name: limits.save }));

    expect(mockSet).toHaveBeenCalledWith(none);
  });
});

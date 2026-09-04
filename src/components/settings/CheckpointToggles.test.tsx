// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));

import { CheckpointToggles } from "./CheckpointToggles";

const config = {
  github_token: "",
  github_user: "",
  github_connected: false,
  ai_api_key: "",
  ai_provider: "openai",
  ai_model: "gpt-4o-mini",
  ai_keys: {},
  ai_system_prompt: "",
  ai_pdf_capture: true,
  ai_provider_models: {},
  ai_custom_providers: [],
  ai_personas: [],
  ai_starter_personas_seeded: false,
  checkpoints_enabled: true,
  checkpoint_notifications: true,
  git_auto_init: true,
  mcp_enabled: false,
  mcp_port: 5323,
  mcp_read_only: false,
  mcp_approval_policy: "ask",
  mcp_servers: [],
} satisfies AppConfig;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockResolvedValue(config);
  mocks.setConfig.mockResolvedValue(undefined);
});

describe("CheckpointToggles", () => {
  it("writes both checkpoint switches back to the app config", async () => {
    const user = userEvent.setup();
    render(<CheckpointToggles />);

    const compileSwitch = await screen.findByRole("switch", {
      name: "Save a checkpoint after each successful compile",
    });
    const noticeSwitch = screen.getByRole("switch", {
      name: "Show a notice when a checkpoint cannot be saved",
    });
    expect(compileSwitch).toHaveAttribute("aria-checked", "true");
    expect(noticeSwitch).toHaveAttribute("aria-checked", "true");

    await user.click(compileSwitch);
    await waitFor(() =>
      expect(mocks.setConfig).toHaveBeenLastCalledWith({ ...config, checkpoints_enabled: false }),
    );
    expect(compileSwitch).toHaveAttribute("aria-checked", "false");

    await user.click(noticeSwitch);
    await waitFor(() =>
      expect(mocks.setConfig).toHaveBeenLastCalledWith({
        ...config,
        checkpoints_enabled: false,
        checkpoint_notifications: false,
      }),
    );
  });

  it("reports a failed config write without losing the card", async () => {
    mocks.setConfig.mockRejectedValueOnce(new Error("disk full"));
    const user = userEvent.setup();
    render(<CheckpointToggles />);

    await user.click(
      await screen.findByRole("switch", {
        name: "Save a checkpoint after each successful compile",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save checkpoint settings.",
    );
    expect(screen.getByTestId("checkpoint-toggles")).toBeInTheDocument();
  });

  it("reports a failed config load", async () => {
    mocks.getConfig.mockRejectedValueOnce(new Error("no config"));
    render(<CheckpointToggles />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load checkpoint settings.",
    );
  });
});

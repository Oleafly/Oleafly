// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setCheckpointDefaults: vi.fn(),
  setConfig: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setCheckpointDefaults: mocks.setCheckpointDefaults,
  setConfig: mocks.setConfig,
}));

import { CheckpointDefaultsSection } from "./CheckpointDefaultsSection";

function appConfig(): AppConfig {
  return {
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
    checkpoint_defaults: {
      mode: "engine_dependencies",
      always_include: ["figures/*.png"],
      ignored: ["scratch/*.tmp"],
      future_option: { enabled: true },
    },
    mcp_enabled: false,
    mcp_port: 5323,
    mcp_read_only: false,
    mcp_approval_policy: "ask",
    mcp_servers: [],
  };
}

describe("CheckpointDefaultsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockResolvedValue(appConfig());
    mocks.setCheckpointDefaults.mockResolvedValue(undefined);
  });

  it("loads the saved checkpoint defaults on mount", async () => {
    render(<CheckpointDefaultsSection />);

    expect(await screen.findByLabelText("Always include")).toHaveValue(
      "figures/*.png",
    );
    expect(screen.getByLabelText("Ignored")).toHaveValue("scratch/*.tmp");
    expect(screen.getByLabelText("Capture mode")).toHaveValue(
      "engine_dependencies",
    );
    expect(mocks.getConfig).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Save defaults" }),
    ).toBeDisabled();
  });

  it("normalizes patterns and preserves future policy fields", async () => {
    const user = userEvent.setup();
    render(<CheckpointDefaultsSection />);

    const alwaysInclude = await screen.findByLabelText("Always include");
    const ignored = screen.getByLabelText("Ignored");
    await user.clear(alwaysInclude);
    await user.type(
      alwaysInclude,
      "figures/*.png\nnotes/appendix.tex\nfigures/*.png\n",
    );
    await user.clear(ignored);
    await user.type(ignored, "generated/*.aux\n");
    await user.click(screen.getByRole("button", { name: "Save defaults" }));

    await waitFor(() =>
      expect(mocks.setCheckpointDefaults).toHaveBeenCalledWith({
        mode: "engine_dependencies",
        always_include: ["figures/*.png", "notes/appendix.tex"],
        ignored: ["generated/*.aux"],
        future_option: { enabled: true },
      }),
    );
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Defaults saved.");
    expect(
      screen.getByRole("button", { name: "Save defaults" }),
    ).toBeDisabled();
  });

  it("shows a validation error without replacing the saved defaults", async () => {
    const user = userEvent.setup();
    mocks.setCheckpointDefaults.mockRejectedValueOnce(
      "Ignored patterns cannot match project.json.",
    );
    render(<CheckpointDefaultsSection />);

    const ignored = await screen.findByLabelText("Ignored");
    await user.clear(ignored);
    await user.type(ignored, "project.json");
    await user.click(screen.getByRole("button", { name: "Save defaults" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ignored patterns cannot match project.json.",
    );
    expect(
      screen.getByRole("button", { name: "Save defaults" }),
    ).toBeEnabled();
  });

  it("can retry when the defaults fail to load", async () => {
    const user = userEvent.setup();
    mocks.getConfig
      .mockRejectedValueOnce(new Error("config unavailable"))
      .mockResolvedValueOnce(appConfig());
    render(<CheckpointDefaultsSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load checkpoint defaults.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Always include")).toHaveValue(
      "figures/*.png",
    );
    expect(mocks.getConfig).toHaveBeenCalledTimes(2);
  });

  it("preserves unsupported defaults until the user explicitly resets them", async () => {
    const user = userEvent.setup();
    const config = appConfig();
    config.checkpoint_defaults = {
      mode: "future_snapshot_mode",
      always_include: ["figures/**"],
      ignored: [],
      future_option: { version: 2 },
    } as unknown as AppConfig["checkpoint_defaults"];
    mocks.getConfig.mockResolvedValue(config);
    render(<CheckpointDefaultsSection />);

    expect(await screen.findByLabelText("Stored checkpoint defaults")).toHaveTextContent(
      "future_snapshot_mode",
    );
    expect(mocks.setCheckpointDefaults).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Reset to safe defaults" }));

    await waitFor(() =>
      expect(mocks.setCheckpointDefaults).toHaveBeenCalledWith({
        mode: "engine_dependencies",
        always_include: [],
        ignored: [],
      }),
    );
  });
});

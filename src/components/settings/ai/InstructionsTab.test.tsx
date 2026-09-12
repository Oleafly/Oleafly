// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setConfig: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  setConfig: mocks.setConfig,
}));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { AppConfig } from "@/lib/tauri";
import { InstructionsTab, type InstructionsTabProps } from "./InstructionsTab";

const instructions = enSettings.ai.instructions;

const cfg = {
  ai_provider: "openai",
  ai_model: "gpt-4o-mini",
  ai_system_prompt: "",
  ai_pdf_capture: true,
  ai_keys: {},
  ai_provider_models: {},
  ai_custom_providers: [],
} as unknown as AppConfig;

function renderTab(overrides: Partial<InstructionsTabProps> = {}) {
  const props: InstructionsTabProps = {
    cfg,
    setCfg: vi.fn(),
    savedKeys: {},
    persist: vi.fn().mockResolvedValue(undefined),
    sysPrompt: "",
    setSysPrompt: vi.fn(),
    sysPromptSaved: false,
    saveSystemPrompt: vi.fn().mockResolvedValue(undefined),
    setMsg: vi.fn(),
    ...overrides,
  };
  render(<InstructionsTab {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setConfig.mockResolvedValue(undefined);
});

describe("InstructionsTab", () => {
  it("explains each section and disables the model picker with no configured provider", () => {
    renderTab();

    expect(screen.getByText(instructions.defaultModelTitle)).toBeInTheDocument();
    expect(screen.getByText(instructions.defaultModelDescription)).toBeInTheDocument();
    expect(screen.getByText(instructions.customTitle)).toBeInTheDocument();
    expect(screen.getByText(instructions.customDescription)).toBeInTheDocument();
    expect(screen.getByText(instructions.capabilitiesTitle)).toBeInTheDocument();
    expect(screen.getByText(instructions.pdfCaptureLabel)).toBeInTheDocument();
    expect(screen.getByText(instructions.pdfCaptureDescription)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(instructions.customPlaceholder),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: instructions.save }),
    ).toBeDisabled();
    expect(screen.queryByText(instructions.saved)).not.toBeInTheDocument();
  });

  it("saves edited instructions and confirms the save", async () => {
    const user = userEvent.setup();
    const setSysPrompt = vi.fn();
    const saveSystemPrompt = vi.fn().mockResolvedValue(undefined);
    renderTab({
      sysPrompt: "Write in British English.",
      sysPromptSaved: true,
      setSysPrompt,
      saveSystemPrompt,
    });

    expect(screen.getByText(instructions.saved)).toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText(instructions.customPlaceholder),
      "!",
    );
    expect(setSysPrompt).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: instructions.save }));
    expect(saveSystemPrompt).toHaveBeenCalled();
  });

  it("writes the PDF capture switch back to the config", async () => {
    const user = userEvent.setup();
    const setCfg = vi.fn();
    renderTab({ setCfg });

    const checkbox = screen.getByRole("checkbox", {
      name: new RegExp(instructions.pdfCaptureLabel),
    });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(setCfg).toHaveBeenCalledWith({ ...cfg, ai_pdf_capture: false });
    expect(mocks.setConfig).toHaveBeenCalledWith({ ...cfg, ai_pdf_capture: false });
    expect(localStorage.getItem("oleafly:ai_pdf_capture")).toBe("0");
  });

  it("reports a config write that fails", async () => {
    const user = userEvent.setup();
    const setMsg = vi.fn();
    mocks.setConfig.mockRejectedValue(new Error("disk full"));
    renderTab({ setMsg });

    await user.click(
      screen.getByRole("checkbox", {
        name: new RegExp(instructions.pdfCaptureLabel),
      }),
    );
    expect(setMsg).toHaveBeenCalledWith({ ok: false, text: "disk full" });
  });

  it("reveals the tool table on request", async () => {
    const user = userEvent.setup();
    renderTab();

    const toggle = screen.getByRole("button", { name: instructions.toolsTitle });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("ai-tools-table")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText(instructions.toolsHint)).toBeInTheDocument();
    expect(screen.getByTestId("ai-tools-table")).toBeInTheDocument();
  });

  it("offers the models of a provider that has a saved key", () => {
    renderTab({
      savedKeys: { openai: "sk-live" },
      cfg: {
        ...cfg,
        ai_provider_models: {
          openai: [{ id: "gpt-4o-mini", name: "GPT-4o mini", enabled: true }],
        },
      } as unknown as AppConfig,
    });

    expect(screen.getByTestId("ai-default-model")).toBeInTheDocument();
  });
});

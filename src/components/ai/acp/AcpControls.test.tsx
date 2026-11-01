import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});

const mocks = vi.hoisted(() => ({ setSnapshot: vi.fn() }));

vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpSetConfigOption: vi.fn(),
  acpSetMode: vi.fn(),
  acpSetModel: vi.fn(),
  acpRefreshPlanUsage: vi.fn(),
}));
vi.mock("@/store/acp-sessions", () => ({
  useAcpSessionsStore: { getState: () => ({ setSnapshot: mocks.setSnapshot }) },
}));

import { acpRefreshPlanUsage, acpSetConfigOption, acpSetMode, acpSetModel, type AcpSession, type AcpSnapshot } from "@/lib/acp";
import {
  booleanOption, choice, chooseOption, claudeOptions, codexOptions, deferred, geminiControls, selectOption, session,
} from "./tests/ui-fixtures";
import { AcpControls } from "./AcpControls";

function withOptions(options: AcpSession["controls"]["options"], overrides: Partial<AcpSession> = {}): AcpSession {
  return session("s", { controls: { models: [], modelId: null, modelConfigId: null, options }, ...overrides });
}

const snapshot = (value: AcpSession): AcpSnapshot => ({ session: value, permissions: [] });

function show(value: AcpSession, { disabled = false, onError = vi.fn() } = {}) {
  render(<AcpControls projectId="paper" session={value} disabled={disabled} onError={onError} />);
  return onError;
}

async function openModelPicker(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId("acp-model-picker"));
  return await waitFor(() => {
    const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Agent model"]');
    if (!listbox) throw new Error("The model picker did not open.");
    return listbox;
  });
}

async function openMoreMenu(): Promise<HTMLElement> {
  fireEvent.pointerDown(screen.getByTestId("acp-more-options"), { button: 0, ctrlKey: false, pointerType: "mouse" });
  return await waitFor(() => {
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    if (!menu) throw new Error("The menu did not open.");
    return menu;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(acpSetConfigOption).mockImplementation(async () => snapshot(session("s")));
  vi.mocked(acpSetMode).mockImplementation(async () => snapshot(session("s")));
  vi.mocked(acpSetModel).mockImplementation(async () => snapshot(session("s")));
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

describe("AcpControls", () => {
  it("changes effort through set_config_option", async () => {
    const onError = show(withOptions(claudeOptions()));
    const trigger = screen.getByTestId("acp-effort-picker");
    expect(trigger).toHaveTextContent("Medium");
    await chooseOption(trigger, "High");
    await waitFor(() => expect(acpSetConfigOption).toHaveBeenCalledWith("paper", "s", "effort", "high"));
    await waitFor(() => expect(mocks.setSnapshot).toHaveBeenCalledWith(snapshot(session("s"))));
    expect(onError).toHaveBeenCalledWith(null);
  });

  it("finds Codex's effort under its own option", async () => {
    show(withOptions(codexOptions()));
    await chooseOption(screen.getByTestId("acp-effort-picker"), "Low");
    await waitFor(() => expect(acpSetConfigOption).toHaveBeenCalledWith("paper", "s", "reasoning_effort", "low"));
  });

  it("toggles Fast as a boolean value", async () => {
    show(withOptions(claudeOptions()));
    await openModelPicker();
    const fast = screen.getByRole("switch", { name: "Fast" });
    expect(fast).not.toBeChecked();
    fireEvent.click(fast);
    await waitFor(() => expect(acpSetConfigOption).toHaveBeenCalledWith("paper", "s", "fast", { type: "boolean", value: true }));
  });

  it("changes a model setting that is a choice", async () => {
    show(withOptions([
      ...claudeOptions(),
      selectOption("context", "Context", "model_config", "200k", [choice("200k", "200K"), choice("1m", "1M")]),
    ]));
    await openModelPicker();
    await chooseOption(screen.getByRole("combobox", { name: "Context" }), "1M");
    await waitFor(() => expect(acpSetConfigOption).toHaveBeenCalledWith("paper", "s", "context", "1m"));
  });

  it("lists a bypass mode but does not let it be chosen", async () => {
    show(withOptions(claudeOptions()));
    fireEvent.pointerDown(screen.getByTestId("acp-mode-picker"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    const listbox = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[role="listbox"]');
      if (!found) throw new Error("The mode list did not open.");
      return found;
    });
    const bypass = within(listbox).getByRole("option", { name: /Bypass permissions/ });
    expect(bypass).toHaveTextContent("Bypass permissions · Off in Oleafly");
    expect(bypass).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(bypass);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acpSetConfigOption).not.toHaveBeenCalled();
  });

  it("changes the mode through set_config_option when the agent reports one", async () => {
    show(withOptions(claudeOptions()));
    await chooseOption(screen.getByTestId("acp-mode-picker"), "Plan");
    await waitFor(() => expect(acpSetConfigOption).toHaveBeenCalledWith("paper", "s", "mode", "plan"));
  });

  it("selects a model from the model picker", async () => {
    show(withOptions(codexOptions()));
    expect(screen.getByTestId("acp-model-picker")).toHaveTextContent("GPT-5.5");
    const listbox = await openModelPicker();
    expect(within(listbox).getByText("OpenAI")).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "GPT-5.5" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(listbox).getByRole("option", { name: "GPT-5.5 mini" }));
    await waitFor(() => expect(acpSetConfigOption).toHaveBeenCalledWith("paper", "s", "model", "gpt-5.5-mini"));
  });

  it("moves between the models with the arrow keys, and only one is in the tab order", async () => {
    show(withOptions(codexOptions()));
    const listbox = await openModelPicker();
    const current = within(listbox).getByRole("option", { name: "GPT-5.5" });
    const mini = within(listbox).getByRole("option", { name: "GPT-5.5 mini" });
    expect(current).toHaveAttribute("tabindex", "0");
    expect(mini).toHaveAttribute("tabindex", "-1");

    current.focus();
    fireEvent.keyDown(current, { key: "ArrowDown" });
    expect(mini).toHaveFocus();
    fireEvent.keyDown(mini, { key: "ArrowDown" });
    expect(mini).toHaveFocus();
    fireEvent.keyDown(mini, { key: "ArrowUp" });
    expect(current).toHaveFocus();
    fireEvent.keyDown(current, { key: "End" });
    expect(mini).toHaveFocus();
    fireEvent.keyDown(mini, { key: "Home" });
    expect(current).toHaveFocus();
    fireEvent.keyDown(current, { key: "g" });
    expect(mini).toHaveFocus();
    expect(fireEvent.keyDown(mini, { key: "Enter" })).toBe(true);
  });

  it("skips a model that cannot be chosen", async () => {
    show(withOptions([
      selectOption("model", "Model", "model", "a", [choice("a", "Alpha"), choice("b", "Beta", { blocked: true }), choice("c", "Gamma")]),
    ]));
    const listbox = await openModelPicker();
    const alpha = within(listbox).getByRole("option", { name: "Alpha" });
    alpha.focus();

    fireEvent.keyDown(alpha, { key: "ArrowDown" });

    expect(within(listbox).getByRole("option", { name: "Gamma" })).toHaveFocus();
    expect(within(listbox).getByRole("option", { name: "Beta" })).toHaveAttribute("tabindex", "-1");
  });

  it("does nothing when the current model is chosen again", async () => {
    show(withOptions(codexOptions()));
    const listbox = await openModelPicker();
    fireEvent.click(within(listbox).getByRole("option", { name: "GPT-5.5" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acpSetConfigOption).not.toHaveBeenCalled();
  });

  it("uses session/set_model and session/set_mode for legacy controls", async () => {
    show(session("s", { controls: geminiControls() }));
    expect(screen.getByTestId("acp-model-picker")).toHaveTextContent("Gemini 3 Pro");
    const listbox = await openModelPicker();
    fireEvent.click(within(listbox).getByRole("option", { name: "Gemini 3 Flash" }));
    await waitFor(() => expect(acpSetModel).toHaveBeenCalledWith("paper", "s", "gemini-3-flash"));
    await chooseOption(screen.getByTestId("acp-mode-picker"), "Plan");
    await waitFor(() => expect(acpSetMode).toHaveBeenCalledWith("paper", "s", "plan"));
    expect(acpSetConfigOption).not.toHaveBeenCalled();
  });

  it("shows the model id when the agent's current model is not in its list", () => {
    show(session("s", { controls: { ...geminiControls(), modelId: "gemini-experimental" } }));
    expect(screen.getByTestId("acp-model-picker")).toHaveTextContent("gemini-experimental");
  });

  it("names the model the agent runs when it offers no list to pick from", () => {
    show(withOptions([]));
    expect(screen.queryByTestId("acp-model-picker")).toBeNull();
    expect(screen.getByTestId("acp-model-label")).toHaveTextContent("Model managed by the agent");
    cleanup();
    show(withOptions([], { controls: { models: [], modelId: "house-model", modelConfigId: null, options: [] } }));
    expect(screen.getByTestId("acp-model-label")).toHaveTextContent("house-model");
  });

  it("changes the agent's other options from the More menu", async () => {
    show(withOptions([
      booleanOption("sandbox", "Sandbox", "_custom", false),
      selectOption("verbosity", "Verbosity", null, "low", [choice("low", "Low"), choice("high", "High")]),
    ]));
    expect(screen.queryByTestId("acp-model-picker")).toBeNull();
    expect(screen.queryByTestId("acp-effort-picker")).toBeNull();
    expect(screen.queryByTestId("acp-mode-picker")).toBeNull();
    let menu = await openMoreMenu();
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Sandbox" }));
    await waitFor(() => expect(acpSetConfigOption).toHaveBeenCalledWith("paper", "s", "sandbox", { type: "boolean", value: true }));
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    menu = await openMoreMenu();
    expect(within(menu).getByText("Verbosity")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "High" }));
    await waitFor(() => expect(acpSetConfigOption).toHaveBeenCalledWith("paper", "s", "verbosity", "high"));
  });

  it("disables every control while a turn runs", () => {
    show(withOptions([...claudeOptions(), booleanOption("sandbox", "Sandbox", "_custom", false)], { status: "running" }));
    expect(screen.getByTestId("acp-model-picker").closest("button")).toBeDisabled();
    expect(screen.getByTestId("acp-effort-picker")).toBeDisabled();
    expect(screen.getByTestId("acp-mode-picker")).toBeDisabled();
    expect(screen.getByTestId("acp-more-options")).toBeDisabled();
  });

  it("disables every control while the composer is disabled", () => {
    show(withOptions(claudeOptions()), { disabled: true });
    expect(screen.getByTestId("acp-model-picker").closest("button")).toBeDisabled();
    expect(screen.getByTestId("acp-effort-picker")).toBeDisabled();
    expect(screen.getByTestId("acp-mode-picker")).toBeDisabled();
  });

  it("reports the agent's error when a change fails", async () => {
    vi.mocked(acpSetConfigOption).mockRejectedValueOnce(new Error("The agent refused this effort."));
    const onError = show(withOptions(claudeOptions()));
    await chooseOption(screen.getByTestId("acp-effort-picker"), "Max");
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith("The agent refused this effort."));
    expect(onError).toHaveBeenNthCalledWith(1, null);
    expect(mocks.setSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes plan usage when the agent has /usage", async () => {
    const pending = deferred<AcpSnapshot>();
    vi.mocked(acpRefreshPlanUsage).mockReturnValue(pending.promise);
    const value = withOptions(claudeOptions(), { availableCommands: [{ name: "usage", description: "Show usage", hint: null }] });
    show(value);
    fireEvent.click(screen.getByRole("button", { name: "View agent usage" }));
    const refresh = await screen.findByRole("button", { name: "Refresh plan usage" });
    fireEvent.click(refresh);
    expect(acpRefreshPlanUsage).toHaveBeenCalledWith("paper", "s");
    expect(await screen.findByRole("button", { name: "Refreshing…" })).toBeDisabled();
    pending.resolve(snapshot(value));
    await waitFor(() => expect(mocks.setSnapshot).toHaveBeenCalledWith(snapshot(value)));
    expect(await screen.findByRole("button", { name: "Refresh plan usage" })).toBeEnabled();
  });

  it("reports a failed plan refresh and offers refresh only with /usage or /status", async () => {
    vi.mocked(acpRefreshPlanUsage).mockRejectedValueOnce("The agent has no usage command.");
    const onError = show(withOptions(claudeOptions(), { availableCommands: [{ name: "status", description: "", hint: null }] }));
    fireEvent.click(screen.getByRole("button", { name: "View agent usage" }));
    fireEvent.click(await screen.findByRole("button", { name: "Refresh plan usage" }));
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith("The agent has no usage command."));
    cleanup();
    show(withOptions(claudeOptions()));
    fireEvent.click(screen.getByRole("button", { name: "View agent usage" }));
    await screen.findByText("No usage in this chat yet.");
    expect(screen.queryByRole("button", { name: "Refresh plan usage" })).toBeNull();
  });
});

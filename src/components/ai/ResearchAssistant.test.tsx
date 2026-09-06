// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistantShellLeading } from "./AssistantShellHeader";
import { ResearchAssistant } from "./ResearchAssistant";
import { useAgentHandoffStore } from "@/store/agent-handoff";
import { useAssistantRuntimeStore } from "@/store/assistant-runtime";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

vi.mock("@/components/ai/ChatCore", () => ({
  ChatCore: () => (
    <div data-testid="chat-core">
      <div data-tour="ai-assistant-header">{useAssistantShellLeading()}</div>
    </div>
  ),
}));

vi.mock("@/components/ai/acp/AcpWorkspaceAssistant", () => ({
  AcpWorkspaceAssistant: () => <div data-testid="acp-assistant" />,
}));

vi.mock("@/components/usage/UsageReport", () => ({
  UsageReportDialog: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
}));

function runtimeButtons() {
  const fieldset = screen.getByRole("group", { name: "Assistant runtime" });
  return Array.from(fieldset.querySelectorAll("button")).map((button) => ({
    label: button.textContent,
    pressed: button.getAttribute("aria-pressed"),
  }));
}

describe("ResearchAssistant shell", () => {
  beforeEach(() => {
    cleanup();
    useAssistantRuntimeStore.setState({ runtime: "built-in", handoffRuntime: null });
    useAgentHandoffStore.setState({ pendingPrompt: null, autoSend: false, pendingImages: [] });
    useFilesStore.setState({ projectId: "project-1" });
    useSettingsStore.setState({ chatFloating: false });
  });

  it("renders one header row with the runtime switch inside the built-in chat header", () => {
    render(<ResearchAssistant />);

    const header = document.querySelector('[data-tour="ai-assistant-header"]');
    expect(header).not.toBeNull();
    expect(header?.querySelector('[aria-label="Assistant runtime"]')).not.toBeNull();
    expect(screen.queryByTestId("acp-assistant-header")).toBeNull();
    expect(screen.queryByRole("button", { name: "Usage report" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agent setup" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New conversation" })).toBeNull();
    expect(runtimeButtons()).toEqual([
      { label: "Oleafly Agent", pressed: "true" },
      { label: "CLI Agent", pressed: "false" },
    ]);
  });

  it("shows the CLI runtime actions in the same row when CLI agents are selected", async () => {
    render(<ResearchAssistant />);

    fireEvent.click(screen.getByRole("button", { name: "CLI Agent" }));

    expect(screen.queryByTestId("chat-core")).toBeNull();
    expect(await screen.findByTestId("acp-assistant")).toBeTruthy();
    const header = screen.getByTestId("acp-assistant-header");
    expect(header.querySelector('[aria-label="Assistant runtime"]')).not.toBeNull();
    for (const name of [
      "New conversation",
      "Saved conversations",
      "Agent setup",
      "Usage report",
    ]) {
      expect(header.querySelector(`[aria-label="${name}"]`), name).not.toBeNull();
    }
    expect(screen.getByTestId("ai-chat-float")).toBeTruthy();
    expect(document.querySelectorAll('[aria-label="Assistant runtime"]')).toHaveLength(1);
    expect(runtimeButtons()).toEqual([
      { label: "Oleafly Agent", pressed: "false" },
      { label: "CLI Agent", pressed: "true" },
    ]);
  });

  it("floats the assistant from the CLI runtime row and opens agent settings from its gear", () => {
    useAssistantRuntimeStore.getState().setRuntime("acp");
    render(<ResearchAssistant />);

    fireEvent.click(screen.getByRole("button", { name: "Agent setup" }));
    expect(useSettingsStore.getState()).toMatchObject({
      settingsInitialSection: "ai",
      settingsScrollTarget: "ai-agents",
      settingsOpen: true,
    });

    fireEvent.click(screen.getByTestId("ai-chat-float"));
    expect(useSettingsStore.getState().chatFloating).toBe(true);
    expect(screen.queryByTestId("ai-chat-float")).toBeNull();
  });

  it("switches to the built-in chat when a handoff arrives while CLI agents are selected", async () => {
    useAssistantRuntimeStore.getState().setRuntime("acp");
    render(<ResearchAssistant />);
    expect(await screen.findByTestId("acp-assistant")).toBeTruthy();

    act(() => {
      useAgentHandoffStore.getState().handoff("Explain this compile error", { autoSend: true });
    });

    expect(screen.getByTestId("chat-core")).toBeTruthy();
    expect(screen.queryByTestId("acp-assistant")).toBeNull();
    expect(runtimeButtons()).toEqual([
      { label: "Oleafly Agent", pressed: "true" },
      { label: "CLI Agent", pressed: "false" },
    ]);
    expect(useAssistantRuntimeStore.getState().runtime).toBe("acp");
  });

  it("asks for a project before offering a CLI agent", () => {
    useFilesStore.setState({ projectId: null });
    useAssistantRuntimeStore.getState().setRuntime("acp");
    render(<ResearchAssistant />);

    expect(screen.getByText("Open a project to work with a CLI agent.")).toBeTruthy();
    expect(screen.getByTestId("acp-assistant-header")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agent setup" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New conversation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Saved conversations" })).toBeNull();
  });
});

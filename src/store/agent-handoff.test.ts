// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { useAgentHandoffStore } from "./agent-handoff";
import { selectActiveRuntime, useAssistantRuntimeStore } from "./assistant-runtime";
import { useToastStore } from "./toast";

describe("agent handoff runtime switch", () => {
  beforeEach(() => {
    localStorage.clear();
    useAssistantRuntimeStore.setState({ runtime: "built-in", handoffRuntime: null });
    useAgentHandoffStore.setState({ pendingPrompt: null, autoSend: false, pendingImages: [] });
    useToastStore.setState({ toasts: [] });
  });

  it("switches the active runtime to built-in when the CLI runtime is selected", () => {
    useAssistantRuntimeStore.getState().setRuntime("acp");

    useAgentHandoffStore.getState().handoff("Fix the compile error", { autoSend: true });

    const runtime = useAssistantRuntimeStore.getState();
    expect(selectActiveRuntime(runtime)).toBe("built-in");
    expect(runtime.runtime).toBe("acp");
    expect(useAgentHandoffStore.getState().pendingPrompt).toBe("Fix the compile error");
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      enCore.assistant.handoffRuntimeSwitch,
    ]);
  });

  it("leaves the runtime alone and stays quiet when built-in is already active", () => {
    useAgentHandoffStore.getState().handoff("Draw a figure of a pendulum");

    const runtime = useAssistantRuntimeStore.getState();
    expect(runtime.runtime).toBe("built-in");
    expect(runtime.handoffRuntime).toBeNull();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("shows one toast for a burst of handoffs and restores the CLI choice on the next explicit pick", () => {
    useAssistantRuntimeStore.getState().setRuntime("acp");

    useAgentHandoffStore.getState().handoff("first");
    useAgentHandoffStore.getState().consume();
    useAgentHandoffStore.getState().handoff("second");

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(selectActiveRuntime(useAssistantRuntimeStore.getState())).toBe("built-in");

    useAssistantRuntimeStore.getState().setRuntime("acp");
    expect(selectActiveRuntime(useAssistantRuntimeStore.getState())).toBe("acp");
    expect(useAssistantRuntimeStore.getState().handoffRuntime).toBeNull();
  });

  it("persists only the explicit runtime choice", () => {
    useAssistantRuntimeStore.getState().setRuntime("acp");
    useAgentHandoffStore.getState().handoff("prompt");

    const saved = JSON.parse(localStorage.getItem("oleafly.assistant-runtime.v1") ?? "{}") as {
      state?: Record<string, unknown>;
    };
    expect(saved.state).toEqual({ runtime: "acp" });
  });
});

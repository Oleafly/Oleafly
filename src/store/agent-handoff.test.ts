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
    useAgentHandoffStore.setState({ pendingPrompt: null, autoSend: false, pendingImages: [], target: "built-in" });
    useToastStore.setState({ toasts: [] });
  });

  it("keeps a hand-off on the CLI assistant when that is the one in use", () => {
    useAssistantRuntimeStore.getState().setRuntime("acp");

    useAgentHandoffStore.getState().handoff("Fix the compile error", { autoSend: true });

    expect(selectActiveRuntime(useAssistantRuntimeStore.getState())).toBe("acp");
    expect(useAgentHandoffStore.getState()).toMatchObject({ pendingPrompt: "Fix the compile error", target: "acp" });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("sends Oleafly's assistant the hand-offs from its own runtime", () => {
    useAgentHandoffStore.getState().handoff("Draw a figure of a pendulum");
    expect(useAgentHandoffStore.getState().target).toBe("built-in");
  });

  it("can move a waiting hand-off to the CLI assistant without changing the saved choice", () => {
    useAgentHandoffStore.getState().handoff("Fix the compile error", { autoSend: false });
    useAgentHandoffStore.getState().redirectToCli();

    const runtime = useAssistantRuntimeStore.getState();
    expect(selectActiveRuntime(runtime)).toBe("acp");
    expect(runtime.runtime).toBe("built-in");
    expect(useAgentHandoffStore.getState().target).toBe("acp");
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([enCore.assistant.handoffToCli]);
    useAgentHandoffStore.getState().consume();
    expect(useAgentHandoffStore.getState().target).toBe("built-in");
  });

  it("switches the active runtime to built-in for a hand-off with images, which the CLI composer can't take", () => {
    useAssistantRuntimeStore.getState().setRuntime("acp");

    useAgentHandoffStore.getState().handoff("Fix the compile error", { autoSend: true, images: ["data:image/png;base64,AA"] });

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
    const images = ["data:image/png;base64,AA"];

    useAgentHandoffStore.getState().handoff("first", { images });
    useAgentHandoffStore.getState().consume();
    useAgentHandoffStore.getState().handoff("second", { images });

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

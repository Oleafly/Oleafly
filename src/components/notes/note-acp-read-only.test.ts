// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpConfigOption, AcpSession, AcpSnapshot } from "@/lib/acp";

const acp = vi.hoisted(() => ({
  acpSetMode: vi.fn(),
  acpSetConfigOption: vi.fn(),
  acpAgentPreferences: vi.fn(),
  acpSetAgentPreference: vi.fn(),
}));
const log = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock("@/lib/acp", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/acp")>()), ...acp }));
vi.mock("@/lib/log", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/log")>()), ...log }));
const gates = vi.hoisted(() => ({ registered: [] as { slot: string; gate: (session: AcpSession) => Promise<boolean> }[] }));
vi.mock("@/store/acp-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/acp-sessions")>();
  return {
    ...actual,
    setAcpPromptGate: (slot: string, gate: (session: AcpSession) => Promise<boolean>) => {
      const entry = { slot, gate };
      gates.registered.push(entry);
      const stop = actual.setAcpPromptGate(slot, gate);
      return () => {
        gates.registered.splice(gates.registered.indexOf(entry), 1);
        stop();
      };
    },
  };
});

import { useAcpSessionsStore } from "@/store/acp-sessions";
import {
  holdToReading,
  isReadOnly,
  READ_ONLY_MODES,
  readOnlyChoice,
  SETTLE_MS,
  useNoteAcpReadOnly,
  useNoteAcpWriteGuard,
} from "./note-acp-read-only";

const SLOT = "paper#note-note-1";
const PREVIOUS = { value: "acceptEdits", name: "Accept edits" };

type Controls = AcpSession["controls"];

function legacy(current: string | null, ids = ["default", "plan"]): Controls {
  return {
    models: [],
    modelId: null,
    modelConfig: null,
    modes: ids.map((id) => ({ id, name: id, description: null, blocked: false })),
    modeId: current,
  } as unknown as Controls;
}

function modeOption(current: string, choices: [string, boolean][]): AcpConfigOption {
  return {
    id: "mode",
    name: "Mode",
    description: null,
    category: "mode",
    kind: {
      type: "select",
      currentValue: current,
      options: choices.map(([value, blocked]) => ({ value, name: value, description: null, group: null, blocked })),
    },
  };
}

function configured(option: AcpConfigOption): Controls {
  return { models: [], modelId: null, modelConfigId: null, options: [option] } as Controls;
}

function session(controls: Controls, extra: Partial<AcpSession> = {}): AcpSession {
  return { id: "s1", projectId: "paper", agentId: "claude", status: "ready", lastSequence: 3, controls, ...extra } as AcpSession;
}

function snapshot(next: AcpSession): AcpSnapshot {
  return { session: next, permissions: [], elicitations: [] } as unknown as AcpSnapshot;
}

function show(next: AcpSession, extra: Record<string, unknown> = {}) {
  useAcpSessionsStore.setState({
    activeByProject: { [SLOT]: next.id },
    sessions: { [next.id]: next },
    queues: {},
    sending: {},
    ...extra,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of [...Object.values(acp), log.logError]) fn.mockReset();
  acp.acpAgentPreferences.mockResolvedValue({ effort: null, mode: PREVIOUS, provider: null });
  acp.acpSetAgentPreference.mockResolvedValue({ effort: null, mode: PREVIOUS, provider: null });
  acp.acpSetMode.mockImplementation(async (_project: string, _id: string, value: string) =>
    snapshot(session(legacy(value))),
  );
  useAcpSessionsStore.setState({ activeByProject: {}, sessions: {}, queues: {}, sending: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("finding an agent's read-only mode", () => {
  it("prefers the same read-only and plan modes as the one-shot path", () => {
    expect(READ_ONLY_MODES).toEqual(["read-only", "readonly", "read_only", "plan"]);
    expect(readOnlyChoice(legacy("default"))?.value).toBe("plan");
    expect(readOnlyChoice(configured(modeOption("auto", [["auto", false], ["read-only", false], ["plan", false]])))?.value).toBe("read-only");
    expect(readOnlyChoice(configured(modeOption("auto", [["auto", false], ["read-only", true]])))).toBeNull();
    expect(readOnlyChoice(legacy("default", ["default", "yolo"]))).toBeNull();
    expect(readOnlyChoice({ models: [], modelId: null, modelConfigId: null } as Controls)).toBeNull();
    expect(readOnlyChoice(undefined)).toBeNull();
  });

  it("says when the session already reads only", () => {
    expect(isReadOnly(legacy("plan"))).toBe(true);
    expect(isReadOnly(legacy("default"))).toBe(false);
    expect(isReadOnly(legacy(null))).toBe(false);
    expect(isReadOnly(configured(modeOption("read-only", [["read-only", false]])))).toBe(true);
    expect(isReadOnly({ models: [], modelId: null, modelConfigId: null } as Controls)).toBe(false);
    expect(isReadOnly(undefined)).toBe(false);
  });
});

describe("holding a note's agent to reading", () => {
  it("switches a legacy mode and puts the agent's remembered mode back", async () => {
    expect(await holdToReading("paper", session(legacy("default")))).toBe(true);
    expect(acp.acpSetMode).toHaveBeenCalledWith("paper", "s1", "plan");
    expect(acp.acpSetAgentPreference).toHaveBeenCalledWith("claude", "mode", PREVIOUS);
    expect(acp.acpAgentPreferences.mock.invocationCallOrder[0]).toBeLessThan(acp.acpSetMode.mock.invocationCallOrder[0]);
    expect(useAcpSessionsStore.getState().sessions.s1.controls.modeId).toBe("plan");
  });

  it("switches a mode option and clears a remembered mode that was not set", async () => {
    acp.acpAgentPreferences.mockResolvedValue({ effort: null, mode: null, provider: null });
    const option = modeOption("auto", [["auto", false], ["read-only", false]]);
    acp.acpSetConfigOption.mockResolvedValue(snapshot(session(configured(modeOption("read-only", [["read-only", false]])))));
    expect(await holdToReading("paper", session(configured(option)))).toBe(true);
    expect(acp.acpSetConfigOption).toHaveBeenCalledWith("paper", "s1", "mode", "read-only");
    expect(acp.acpSetAgentPreference).toHaveBeenCalledWith("claude", "mode", null);
  });

  it("leaves an agent without a read-only mode alone", async () => {
    expect(await holdToReading("paper", session(legacy("default", ["default"])))).toBe(false);
    expect(acp.acpAgentPreferences).not.toHaveBeenCalled();
    expect(acp.acpSetMode).not.toHaveBeenCalled();
  });
});

describe("useNoteAcpReadOnly", () => {
  it("switches an idle session after it settles and reports it", async () => {
    show(session(legacy("default")));
    const { result } = renderHook(() => useNoteAcpReadOnly("paper", SLOT, true));
    expect(result.current).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    });
    expect(acp.acpSetMode).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(acp.acpSetMode).toHaveBeenCalledOnce();
    expect(result.current).toBe(true);
  });

  it("waits while a prompt is queued, sending or running", async () => {
    show(session(legacy("default")), { queues: { s1: [{ id: "q1" }] } });
    renderHook(() => useNoteAcpReadOnly("paper", SLOT, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    });
    act(() => useAcpSessionsStore.setState({ queues: {}, sending: { s1: 1 } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    });
    act(() => useAcpSessionsStore.setState({ sending: {}, sessions: { s1: session(legacy("default"), { status: "running" }) } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    });
    expect(acp.acpSetMode).not.toHaveBeenCalled();
    act(() => useAcpSessionsStore.setState({ sessions: { s1: session(legacy("default")) } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    });
    expect(acp.acpSetMode).toHaveBeenCalledOnce();
  });

  it("does nothing for an unlinked note or a session that already reads only", async () => {
    show(session(legacy("default")));
    const off = renderHook(() => useNoteAcpReadOnly("note-1", SLOT, false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    });
    expect(off.result.current).toBe(false);
    off.unmount();
    show(session(legacy("plan")));
    const held = renderHook(() => useNoteAcpReadOnly("paper", SLOT, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    });
    expect(held.result.current).toBe(true);
    useAcpSessionsStore.setState({ activeByProject: {} });
    expect(acp.acpSetMode).not.toHaveBeenCalled();
    held.unmount();
  });

  it("stops after three failed tries and logs each", async () => {
    acp.acpSetMode.mockRejectedValue(new Error("busy"));
    show(session(legacy("default")));
    const { unmount } = renderHook(() => useNoteAcpReadOnly("paper", SLOT, true));
    for (let round = 0; round < 5; round += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
      });
      act(() => useAcpSessionsStore.setState({ sessions: { s1: session(legacy("default")) } }));
    }
    expect(acp.acpSetMode).toHaveBeenCalledTimes(3);
    expect(log.logError).toHaveBeenCalledTimes(3);
    unmount();
  });
});

describe("holding to reading once at a time", () => {
  it("shares one switch between callers so the remembered mode is put back as it was", async () => {
    let finish: () => void = () => {};
    acp.acpSetMode.mockImplementation(
      (_project: string, _id: string, value: string) =>
        new Promise((resolve) => {
          finish = () => resolve(snapshot(session(legacy(value))));
        }),
    );
    const first = holdToReading("paper", session(legacy("default")));
    const second = holdToReading("paper", session(legacy("default")));
    await vi.waitFor(() => expect(acp.acpSetMode).toHaveBeenCalledOnce());
    finish();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(acp.acpAgentPreferences).toHaveBeenCalledOnce();
    expect(acp.acpSetAgentPreference).toHaveBeenCalledOnce();
    expect(acp.acpSetAgentPreference).toHaveBeenCalledWith("claude", "mode", PREVIOUS);
  });
});

describe("useNoteAcpWriteGuard", () => {
  function gate() {
    const entry = gates.registered.find((registered) => registered.slot === SLOT);
    if (!entry) throw new Error("no gate");
    return entry.gate;
  }

  beforeEach(() => {
    vi.useRealTimers();
  });

  it("lets a prompt through only once the session reads only", async () => {
    const shown = session(legacy("default"));
    show(shown);
    const { result } = renderHook(() => useNoteAcpWriteGuard("paper", SLOT, true));
    expect(await gate()(shown)).toBe(true);
    expect(acp.acpSetMode).toHaveBeenCalledWith("paper", "s1", "plan");
    expect(isReadOnly(useAcpSessionsStore.getState().sessions.s1.controls)).toBe(true);
    expect(result.current).toBeNull();
    acp.acpSetMode.mockClear();
    expect(await gate()(session(legacy("plan")))).toBe(true);
    expect(acp.acpSetMode).not.toHaveBeenCalled();
  });

  it("asks before sending to an agent with no read-only mode and remembers a yes for the session", async () => {
    const shown = session(legacy("default", ["default"]), { id: "g2", agentId: "gemini" });
    show(shown);
    const { result } = renderHook(() => useNoteAcpWriteGuard("paper", SLOT, true));
    const refused = gate()(shown);
    await vi.waitFor(() => expect(result.current).toMatchObject({ sessionId: "g2", agentId: "gemini" }));
    act(() => result.current?.decline());
    expect(await refused).toBe(false);
    expect(result.current).toBeNull();
    const first = gate()(shown);
    const second = gate()(shown);
    await vi.waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current?.allow());
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(await gate()(shown)).toBe(true);
    expect(result.current).toBeNull();
    expect(acp.acpSetMode).not.toHaveBeenCalled();
  });

  it("asks when the switch to reading fails", async () => {
    acp.acpSetMode.mockRejectedValue(new Error("busy"));
    const shown = session(legacy("default"), { id: "g3" });
    show(shown);
    const { result } = renderHook(() => useNoteAcpWriteGuard("paper", SLOT, true));
    const pending = gate()(shown);
    await vi.waitFor(() => expect(result.current?.sessionId).toBe("g3"));
    expect(log.logError).toHaveBeenCalledOnce();
    act(() => result.current?.allow());
    expect(await pending).toBe(true);
  });

  it("refuses a waiting prompt when the panel closes and guards nothing for an unlinked note", async () => {
    const shown = session(legacy("default", ["default"]), { id: "g4" });
    show(shown);
    const off = renderHook(() => useNoteAcpWriteGuard("note-1", SLOT, false));
    expect(gates.registered).toEqual([]);
    off.unmount();
    const { result, unmount } = renderHook(() => useNoteAcpWriteGuard("paper", SLOT, true));
    const pending = gate()(shown);
    await vi.waitFor(() => expect(result.current).not.toBeNull());
    unmount();
    expect(await pending).toBe(false);
    expect(gates.registered).toEqual([]);
  });
});

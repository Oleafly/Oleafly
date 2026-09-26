// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProofreadingPhase } from "@/store/proofreading";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";

const editor = vi.hoisted(() => ({
  getEditorView: vi.fn(() => null),
  refreshEditorLints: vi.fn(),
}));

const client = vi.hoisted(() => ({ retryProofreading: vi.fn() }));
const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));

vi.mock("@oleafly/editor", () => editor);
vi.mock("@/lib/proofreading/client", () => client);
vi.mock("@/lib/log", () => log);

import {
  PROOFREADING_RETRY_POLICY,
  ProofreadingNotifications,
} from "./ProofreadingNotifications";
import { fixRandomFraction } from "@/lib/test-utils";

const HARPER_CRASH = "Harper crashed";
const RETRY_EVENT = "oleafly:proofreading-retry";

function surfaceState(phase: ProofreadingPhase, extra: Record<string, unknown> = {}) {
  return {
    phase,
    identity: {
      projectId: "project",
      path: "main.tex",
      revision: 1,
      requestGeneration: 1,
      surface: "source" as const,
    },
    message: null,
    diagnosticCount: 0,
    diagnostics: [],
    truncated: false,
    activeDictionaryLocale: null,
    retryable: true,
    ...extra,
  };
}

function mount(phase: ProofreadingPhase, extra: Record<string, unknown> = {}) {
  useProofreadingStore.setState({ source: surfaceState(phase, extra) });
  return render(<ProofreadingNotifications path="main.tex" surface="source" />);
}

function setPhase(phase: ProofreadingPhase, extra: Record<string, unknown> = {}) {
  act(() => {
    useProofreadingStore.setState({ source: surfaceState(phase, extra) });
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("ProofreadingNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fixRandomFraction(1);
    useToastStore.getState().reset();
    useSettingsStore.setState({ spellcheck: true, harper: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders no chrome of its own", () => {
    const { container } = mount("ready");

    expect(container).toBeEmptyDOMElement();
  });

  it("never shows a toast for any checker state", () => {
    for (const phase of [
      "error",
      "unavailable",
      "too_large",
      "unsupported",
      "partial",
      "loading",
    ] as const) {
      const view = mount(phase, { message: HARPER_CRASH });
      view.unmount();
    }

    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("retries a failed checker in the background and logs the failure once", async () => {
    mount("error", { message: HARPER_CRASH });
    expect(client.retryProofreading).not.toHaveBeenCalled();

    await advance(PROOFREADING_RETRY_POLICY.baseMs);
    expect(client.retryProofreading).toHaveBeenCalledWith("source");
    expect(editor.refreshEditorLints).toHaveBeenCalledOnce();
    expect(log.logError).toHaveBeenCalledOnce();
    expect(log.logError).toHaveBeenCalledWith(
      "proofreading source",
      `error: ${HARPER_CRASH}`,
    );

    setPhase("idle");
    setPhase("loading");
    setPhase("error", { message: HARPER_CRASH });
    await advance(PROOFREADING_RETRY_POLICY.baseMs * 2 - 1);
    expect(client.retryProofreading).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(client.retryProofreading).toHaveBeenCalledTimes(2);
    expect(log.logError).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("starts the backoff over once a pass succeeds", async () => {
    mount("unavailable");
    await advance(PROOFREADING_RETRY_POLICY.baseMs);
    expect(client.retryProofreading).toHaveBeenCalledTimes(1);

    setPhase("ready");
    setPhase("unavailable");
    await advance(PROOFREADING_RETRY_POLICY.baseMs);
    expect(client.retryProofreading).toHaveBeenCalledTimes(2);
    expect(log.logError).toHaveBeenCalledTimes(2);
  });

  it("does not keep restarting the worker for a dictionary that is not installed", async () => {
    mount("unavailable", { retryable: false });
    await advance(PROOFREADING_RETRY_POLICY.maxMs);

    expect(client.retryProofreading).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("does not retry states a retry cannot fix", async () => {
    mount("too_large");
    await advance(PROOFREADING_RETRY_POLICY.maxMs);
    setPhase("unsupported");
    await advance(PROOFREADING_RETRY_POLICY.maxMs);
    setPhase("partial", { diagnosticCount: 4 });
    await advance(PROOFREADING_RETRY_POLICY.maxMs);

    expect(client.retryProofreading).not.toHaveBeenCalled();
    expect(log.logError).not.toHaveBeenCalled();
  });

  it("stays quiet for another file, an idle checker, or proofreading turned off", async () => {
    useProofreadingStore.setState({ source: surfaceState("error") });
    const other = render(<ProofreadingNotifications path="other.tex" surface="source" />);
    await advance(PROOFREADING_RETRY_POLICY.maxMs);
    other.unmount();

    const idle = mount("idle");
    await advance(PROOFREADING_RETRY_POLICY.maxMs);
    idle.unmount();

    useSettingsStore.setState({ spellcheck: false, harper: false });
    mount("error");
    await advance(PROOFREADING_RETRY_POLICY.maxMs);

    expect(client.retryProofreading).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("stops retrying when the editor unmounts", async () => {
    const view = mount("error");
    view.unmount();

    await advance(PROOFREADING_RETRY_POLICY.maxMs * 2);
    expect(client.retryProofreading).not.toHaveBeenCalled();
  });

  it("retries the visual surface without touching the source lints", async () => {
    const events: Event[] = [];
    const listener = (event: Event) => void events.push(event);
    window.addEventListener(RETRY_EVENT, listener);
    useProofreadingStore.setState({
      visual: surfaceState("error", {
        identity: {
          projectId: "project",
          path: "main.tex",
          revision: 1,
          requestGeneration: 1,
          surface: "visual" as const,
        },
      }),
    });
    render(<ProofreadingNotifications path="main.tex" surface="visual" />);

    await advance(PROOFREADING_RETRY_POLICY.baseMs);
    window.removeEventListener(RETRY_EVENT, listener);

    expect(client.retryProofreading).toHaveBeenCalledWith("visual");
    expect(editor.refreshEditorLints).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
  });
});

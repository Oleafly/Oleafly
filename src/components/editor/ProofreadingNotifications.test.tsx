// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { ProofreadingPhase } from "@/store/proofreading";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

const sonner = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));

const editor = vi.hoisted(() => ({
  getEditorView: vi.fn(() => null),
  refreshEditorLints: vi.fn(),
}));

const client = vi.hoisted(() => ({ retryProofreading: vi.fn() }));

vi.mock("sonner", () => ({ toast: sonner }));
vi.mock("@oleafly/editor", () => editor);
vi.mock("@/lib/proofreading/client", () => client);

import { ProofreadingNotifications } from "./ProofreadingNotifications";

const copy = en.proofreading;

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
    ...extra,
  };
}

function mount(phase: ProofreadingPhase, extra: Record<string, unknown> = {}) {
  useProofreadingStore.setState({ source: surfaceState(phase, extra) });
  return render(<ProofreadingNotifications path="main.tex" surface="source" />);
}

describe("ProofreadingNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ spellcheck: true, harper: true });
  });

  it("renders no chrome of its own", () => {
    const { container } = mount("ready");

    expect(container).toBeEmptyDOMElement();
  });

  it("interrupts with a retry action when the checker fails", () => {
    mount("error");

    expect(sonner.error).toHaveBeenCalledWith(copy.error, expect.anything());
    const options = sonner.error.mock.lastCall?.[1] as {
      action: { label: string; onClick: () => void };
    };
    expect(options.action.label).toBe(copy.retry);

    options.action.onClick();
    expect(client.retryProofreading).toHaveBeenCalledWith("source");
    expect(editor.refreshEditorLints).toHaveBeenCalledOnce();
  });

  it("names the offline checker", () => {
    mount("unavailable");

    expect(sonner.error).toHaveBeenCalledWith(copy.unavailable, expect.anything());
  });

  it("warns without a retry for the states a retry cannot fix", () => {
    mount("too_large");
    expect(sonner.warning).toHaveBeenCalledWith(copy.tooLarge, expect.anything());
    const warned = sonner.warning.mock.lastCall as [string, { action?: unknown }];
    expect(warned[1].action).toBeUndefined();

    mount("unsupported");
    expect(sonner.warning).toHaveBeenCalledWith(copy.unsupported, expect.anything());

    mount("partial", { diagnosticCount: 4 });
    expect(sonner.warning).toHaveBeenCalledWith(
      copy.partial_other.replace("{{count}}", "4"),
      expect.anything(),
    );
  });

  it("prefers a message the checker supplied", () => {
    mount("error", { message: "Harper crashed" });

    expect(sonner.error).toHaveBeenCalledWith("Harper crashed", expect.anything());
  });

  it("stays quiet for another file, an idle checker, or proofreading turned off", () => {
    useProofreadingStore.setState({ source: surfaceState("error") });
    render(<ProofreadingNotifications path="other.tex" surface="source" />);
    expect(sonner.error).not.toHaveBeenCalled();

    mount("idle");
    expect(sonner.error).not.toHaveBeenCalled();

    useSettingsStore.setState({ spellcheck: false, harper: false });
    mount("error");
    expect(sonner.error).not.toHaveBeenCalled();
    expect(sonner.dismiss).toHaveBeenCalledWith("proofreading:source");
  });

  it("retries the visual surface without touching the source lints", () => {
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

    const options = sonner.error.mock.lastCall?.[1] as {
      action: { onClick: () => void };
    };
    options.action.onClick();

    expect(client.retryProofreading).toHaveBeenCalledWith("visual");
    expect(editor.refreshEditorLints).not.toHaveBeenCalled();
  });
});

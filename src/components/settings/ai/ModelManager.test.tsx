// @vitest-environment jsdom

import { StrictMode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { ModelProbe, StoredModel } from "@/lib/tauri";
import {
  agentListModels,
  agentModelMetadataStatus,
  agentRefreshModelMetadata,
} from "@/lib/tauri";
import { resetModelListRefreshLedger } from "@/lib/ai-model-state";
import { formatDate } from "@/lib/intl";
import { createAppQueryClient } from "@/lib/query";
import { ModelManager, ModelMetadataStatusLine, type ModelManagerProps } from "./ModelManager";

vi.mock("@/lib/tauri", () => ({
  agentListModels: vi.fn(),
  agentModelMetadataStatus: vi.fn(),
  agentRefreshModelMetadata: vi.fn(),
}));
vi.mock("@/lib/agent-backend", () => ({
  agentErrorKind: (error: unknown) =>
    String(error).includes("401") ? "auth" : "network",
}));

const mockList = vi.mocked(agentListModels);
const mockStatus = vi.mocked(agentModelMetadataStatus);
const mockRefreshMetadata = vi.mocked(agentRefreshModelMetadata);

const HOUR = 60 * 60 * 1000;

const MODELS: StoredModel[] = [
  { id: "gpt-alpha", name: "Alpha", enabled: true, source: "builtin" },
];

function mountManager(
  overrides: Partial<Omit<ModelManagerProps, "onChange">> = {},
  options: { strict?: boolean } = {},
) {
  const onChange = vi.fn();
  const tree = (
    <QueryClientProvider client={createAppQueryClient()}>
      <ModelManager
        providerId="openai"
        models={MODELS}
        apiKey="sk-test"
        refreshedAt={Date.now()}
        {...overrides}
        onChange={onChange}
      />
    </QueryClientProvider>
  );
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { onChange, unmount: view.unmount };
}

function renderManager(overrides: Partial<Omit<ModelManagerProps, "onChange">> = {}) {
  return mountManager(overrides).onChange;
}

describe("ModelManager refresh", () => {
  beforeEach(() => {
    mockList.mockReset();
    resetModelListRefreshLedger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges the fetched provider models into the stored list", async () => {
    mockList.mockResolvedValue([{ id: "gpt-beta", name: "Beta", trust: "untested" }]);
    const onChange = renderManager();

    fireEvent.click(screen.getByTestId("ai-refresh-models-openai"));

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const next = onChange.mock.calls[0]?.[0] as StoredModel[];
    expect(next.map((m) => m.id)).toContain("gpt-beta");
  });

  it("reports an invalid key distinctly from a network failure", async () => {
    mockList.mockRejectedValue(new Error("HTTP 401"));
    renderManager();

    fireEvent.click(screen.getByTestId("ai-refresh-models-openai"));

    expect(await screen.findByText(enSettings.ai.models.invalidKey)).toBeInTheDocument();
  });

  it("reports what changed and stamps the refresh time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-03T10:00:00Z"));
    mockList.mockResolvedValue([
      { id: "gpt-alpha", name: "Alpha", trust: "verified" },
      { id: "gpt-gamma", name: "Gamma", trust: "untested" },
    ]);
    const onRefreshed = vi.fn();
    const onChange = renderManager({
      models: [
        ...MODELS,
        { id: "gpt-beta", name: "Beta", enabled: true, source: "fetched" },
      ],
      onRefreshed,
    });

    fireEvent.click(screen.getByTestId("ai-refresh-models-openai"));

    await waitFor(() => expect(onRefreshed).toHaveBeenCalledOnce());
    expect(onChange).not.toHaveBeenCalled();
    const [merged, stamp] = onRefreshed.mock.calls[0] as [StoredModel[], number];
    expect(merged.map((m) => m.id)).toEqual(["gpt-alpha", "gpt-gamma"]);
    expect(stamp).toBe(Date.parse("2026-09-03T10:00:00Z"));
    expect(screen.getByTestId("ai-refresh-notice-openai")).toHaveTextContent(
      enSettings.ai.models.changeSummary.replace("{{added}}", "1").replace("{{removed}}", "1"),
    );

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(4_500);
    });
    expect(screen.queryByTestId("ai-refresh-notice-openai")).not.toBeInTheDocument();
  });

  it("says when nothing changed", async () => {
    mockList.mockResolvedValue([{ id: "gpt-alpha", name: "Alpha", trust: "verified" }]);
    const onChange = renderManager();

    fireEvent.click(screen.getByTestId("ai-refresh-models-openai"));

    expect(await screen.findByText(enSettings.ai.models.noChanges)).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("keeps the previous list when the provider returns models it cannot read", async () => {
    mockList.mockResolvedValue([{ id: "", name: "", trust: "untested" }]);
    const onRefreshed = vi.fn();
    const onChange = renderManager({ onRefreshed });

    fireEvent.click(screen.getByTestId("ai-refresh-models-openai"));

    expect(
      await screen.findByText(enSettings.ai.models.unreadableList),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(onRefreshed).not.toHaveBeenCalled();
    expect(screen.getByTestId("ai-model-row-gpt-alpha")).toBeInTheDocument();
  });

  it("allows one refresh per provider every thirty seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockList.mockResolvedValue([{ id: "gpt-alpha", name: "Alpha", trust: "verified" }]);
    const onChange = renderManager();
    const button = screen.getByTestId("ai-refresh-models-openai");

    fireEvent.click(button);
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(mockList).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it("keeps the throttle while the card is closed and opened again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockList.mockResolvedValue([{ id: "gpt-alpha", name: "Alpha", trust: "verified" }]);
    const first = mountManager();

    fireEvent.click(screen.getByTestId("ai-refresh-models-openai"));
    await waitFor(() => expect(first.onChange).toHaveBeenCalledOnce());
    first.unmount();

    mountManager();
    const button = screen.getByTestId("ai-refresh-models-openai");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockList).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("attempts the daily refresh once and frees Refresh when that attempt fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-03T10:00:00Z"));
    mockList.mockRejectedValue(new Error("offline"));
    const stale = Date.now() - 25 * HOUR;
    const first = mountManager({ refreshedAt: stale });

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("ai-refresh-models-openai")).toBeEnabled());
    first.unmount();

    mountManager({ refreshedAt: stale });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(mockList).toHaveBeenCalledTimes(1);
    const button = screen.getByTestId("ai-refresh-models-openai");
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it("finishes the daily refresh when StrictMode mounts the card twice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-03T10:00:00Z"));
    mockList.mockResolvedValue([{ id: "gpt-alpha", name: "Alpha", trust: "verified" }]);
    const onRefreshed = vi.fn();
    mountManager({ refreshedAt: Date.now() - 25 * HOUR, onRefreshed }, { strict: true });

    await waitFor(() => expect(onRefreshed).toHaveBeenCalledOnce());
    expect(mockList).toHaveBeenCalledTimes(1);

    const button = screen.getByTestId("ai-refresh-models-openai");
    await waitFor(() => expect(button.querySelector(".animate-spin")).toBeNull());

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(mockList).toHaveBeenCalledTimes(1);

    fireEvent.click(button);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button.querySelector(".animate-spin")).toBeNull());
  });

  it("shows when the list was last updated", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T10:00:00Z"));
    renderManager({ refreshedAt: Date.now() - 5 * 60_000 });
    expect(screen.getByTestId("ai-models-updated-openai")).toHaveTextContent(
      enSettings.ai.models.updated.replace("{{time}}", "5 minutes ago"),
    );
  });

  it("refreshes on open once a day and stays quiet when that fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-03T10:00:00Z"));
    mockList.mockRejectedValue(new Error("offline"));
    renderManager({ refreshedAt: Date.now() - 25 * HOUR });

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(enSettings.ai.models.unreachable)).not.toBeInTheDocument();
    expect(screen.queryByText(enSettings.ai.models.invalidKey)).not.toBeInTheDocument();
  });

  it("does not refresh on open when the list is less than a day old", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-03T10:00:00Z"));
    mockList.mockResolvedValue([]);
    renderManager({ refreshedAt: Date.now() - 23 * HOUR });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(mockList).not.toHaveBeenCalled();
    expect(screen.getByTestId("ai-refresh-models-openai")).toBeEnabled();
  });

  it("refreshes on open when the list has never been fetched", async () => {
    mockList.mockResolvedValue([{ id: "gpt-alpha", name: "Alpha", trust: "verified" }]);
    const onRefreshed = vi.fn();
    renderManager({ refreshedAt: undefined, onRefreshed });

    await waitFor(() => expect(onRefreshed).toHaveBeenCalledOnce());
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("offers no refresh for providers without model discovery", () => {
    renderManager({ refreshedAt: undefined, discoverable: false });
    expect(mockList).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ai-refresh-models-openai")).not.toBeInTheDocument();
  });
});

describe("ModelManager badges", () => {
  beforeEach(() => {
    mockList.mockReset();
    resetModelListRefreshLedger();
  });

  it("shows trust badges and capability chips, resolving persisted probes", async () => {
    const probes: Record<string, ModelProbe> = {
      "openai/gpt-gamma": {
        verdict: "blocked",
        reason: "No tool call came back.",
        probedAt: 5,
      },
      "openai/gpt-delta": { verdict: "verified", reason: "", probedAt: 5 },
    };
    renderManager({
      probes,
      models: [
        {
          id: "gpt-alpha",
          name: "Alpha",
          enabled: true,
          source: "fetched",
          trust: "verified",
          metadata: {
            name: "Alpha",
            contextWindow: 200000,
            inputModalities: ["text", "image"],
            outputModalities: ["text"],
            toolCall: true,
            reasoning: true,
            attachment: true,
            structuredOutput: true,
            status: "deprecated",
          },
        },
        {
          id: "gpt-beta",
          name: "Beta",
          enabled: true,
          source: "fetched",
          trust: "blocked",
          blockedReason: "Its thinking output breaks the assistant loop.",
        },
        { id: "gpt-gamma", name: "Gamma", enabled: true, source: "fetched", trust: "untested" },
        { id: "gpt-delta", name: "Delta", enabled: true, source: "fetched", trust: "untested" },
        { id: "plain", name: "Plain", enabled: true, source: "builtin" },
      ],
    });

    const alpha = screen.getByTestId("ai-model-row-gpt-alpha");
    expect(alpha).toHaveTextContent("Verified");
    expect(alpha).toHaveTextContent("200k");
    expect(alpha).toHaveTextContent("Vision");
    expect(alpha).toHaveTextContent("Tools");
    expect(alpha).toHaveTextContent("Reasoning");
    expect(alpha).toHaveTextContent("Deprecated");

    expect(screen.getByTestId("ai-model-row-gpt-beta")).toHaveTextContent("Blocked");
    expect(screen.getByTestId("ai-model-row-gpt-gamma")).toHaveTextContent("Blocked");
    expect(screen.getByTestId("ai-model-row-gpt-delta")).toHaveTextContent("Verified");
    expect(screen.getByTestId("ai-model-row-plain")).not.toHaveTextContent("Untested");

    const gammaBadge = screen
      .getByTestId("ai-model-row-gpt-gamma")
      .querySelector('[data-testid="ai-model-trust-blocked"]') as HTMLElement;
    fireEvent.mouseEnter(gammaBadge.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("No tool call came back.");
  });

  it("explains a blocked badge to a keyboard user", async () => {
    renderManager({
      models: [
        {
          id: "gpt-beta",
          name: "Beta",
          enabled: true,
          source: "fetched",
          trust: "blocked",
          blockedReason: "Its thinking output breaks the assistant loop.",
        },
      ],
    });

    const badge = screen
      .getByTestId("ai-model-row-gpt-beta")
      .querySelector('[data-testid="ai-model-trust-blocked"]') as HTMLElement;
    fireEvent.keyDown(document, { key: "Tab" });
    act(() => badge.focus());

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Its thinking output breaks the assistant loop.",
    );
  });

  it("explains a blocked badge that carries no reason", async () => {
    renderManager({
      models: [
        { id: "gpt-beta", name: "Beta", enabled: true, source: "fetched", trust: "blocked" },
      ],
    });

    const badge = screen
      .getByTestId("ai-model-row-gpt-beta")
      .querySelector('[data-testid="ai-model-trust-blocked"]') as HTMLElement;
    fireEvent.mouseEnter(badge.parentElement as HTMLElement);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "The assistant cannot run on this model",
    );
  });

  it("leaves badges that need no explanation out of the tab order", () => {
    renderManager({
      models: [
        { id: "gpt-alpha", name: "Alpha", enabled: true, source: "fetched", trust: "verified" },
        { id: "gpt-gamma", name: "Gamma", enabled: true, source: "fetched", trust: "untested" },
      ],
    });

    expect(screen.getByTestId("ai-model-trust-verified")).not.toHaveAttribute("tabindex");
    expect(screen.getByTestId("ai-model-trust-untested")).not.toHaveAttribute("tabindex");
  });
});

describe("ModelMetadataStatusLine", () => {
  beforeEach(() => {
    mockStatus.mockReset();
    mockRefreshMetadata.mockReset();
  });

  it("shows the snapshot date and refreshes it on request", async () => {
    mockStatus.mockResolvedValue({
      source: "bundled",
      generatedAt: "2026-08-20T12:00:00Z",
      refreshedAt: null,
    });
    mockRefreshMetadata.mockResolvedValue({
      source: "cdn",
      generatedAt: "2026-09-01T12:00:00Z",
      refreshedAt: Date.now(),
    });
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ModelMetadataStatusLine />
      </QueryClientProvider>,
    );

    const line = await screen.findByTestId("ai-model-metadata-status");
    expect(line).toHaveTextContent(
      enSettings.ai.models.metadata.updatedBundled.replace(
        "{{date}}",
        formatDate(new Date("2026-08-20T12:00:00Z")),
      ),
    );

    fireEvent.click(screen.getByTestId("ai-model-metadata-refresh"));

    await waitFor(() => expect(mockRefreshMetadata).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(screen.getByTestId("ai-model-metadata-status")).toHaveTextContent(
        enSettings.ai.models.metadata.updated.replace(
          "{{date}}",
          formatDate(new Date("2026-09-01T12:00:00Z")),
        ),
      ),
    );
    expect(screen.getByTestId("ai-model-metadata-status")).not.toHaveTextContent("bundled");
  });

  it("renders nothing when the status cannot be read", async () => {
    mockStatus.mockRejectedValue(new Error("unsupported"));
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ModelMetadataStatusLine />
      </QueryClientProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("ai-model-metadata-status")).not.toBeInTheDocument();
  });

  it("names a cached snapshot and an unparseable date", async () => {
    mockStatus.mockResolvedValue({
      source: "cache",
      generatedAt: "not a date",
      refreshedAt: null,
    });
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ModelMetadataStatusLine />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("ai-model-metadata-status")).toHaveTextContent(
      enSettings.ai.models.metadata.updatedFromCache.replace(
        "{{date}}",
        enSettings.ai.models.metadata.unknownDate,
      ),
    );
  });

  it("reports a metadata refresh that fails", async () => {
    mockStatus.mockResolvedValue({
      source: "cdn",
      generatedAt: "2026-08-20T12:00:00Z",
      refreshedAt: null,
    });
    mockRefreshMetadata.mockRejectedValue(new Error("offline"));
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ModelMetadataStatusLine />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId("ai-model-metadata-refresh"));
    expect(
      await screen.findByText(enSettings.ai.models.metadata.refreshFailed),
    ).toBeInTheDocument();
  });
});

const modelsCopy = enSettings.ai.models;

describe("ModelManager list editing", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockStatus.mockReset();
    resetModelListRefreshLedger();
  });

  it("refuses an empty, a spaced, and a duplicate model id", () => {
    const onChange = renderManager();
    const field = screen.getByTestId("ai-add-model-id-openai");
    const submit = screen.getByTestId("ai-add-model-submit-openai");

    fireEvent.click(submit);
    expect(screen.getByTestId("ai-add-model-error-openai")).toHaveTextContent(
      modelsCopy.addError.empty,
    );

    fireEvent.change(field, { target: { value: "two words" } });
    fireEvent.click(submit);
    expect(screen.getByTestId("ai-add-model-error-openai")).toHaveTextContent(
      modelsCopy.addError.spaces,
    );

    fireEvent.change(field, { target: { value: "gpt-alpha" } });
    fireEvent.click(submit);
    expect(screen.getByTestId("ai-add-model-error-openai")).toHaveTextContent(
      modelsCopy.addError.duplicate,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds a model on Enter and clears the error while typing", () => {
    const onChange = renderManager();
    const field = screen.getByTestId("ai-add-model-id-openai");

    fireEvent.click(screen.getByTestId("ai-add-model-submit-openai"));
    expect(screen.getByTestId("ai-add-model-error-openai")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "gpt-beta" } });
    expect(screen.queryByTestId("ai-add-model-error-openai")).not.toBeInTheDocument();

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].some((m: StoredModel) => m.id === "gpt-beta")).toBe(
      true,
    );
  });

  it("toggles a model off", () => {
    const onChange = renderManager();

    fireEvent.click(screen.getByTestId("ai-model-toggle-gpt-alpha"));
    expect(onChange).toHaveBeenCalled();
    expect(
      onChange.mock.calls[0][0].find((m: StoredModel) => m.id === "gpt-alpha")?.enabled,
    ).toBe(false);
  });

  it("asks before deleting a model and honours both answers", async () => {
    const onChange = renderManager();

    fireEvent.click(screen.getByTestId("ai-model-delete-gpt-alpha"));
    expect(screen.getByText(modelsCopy.deleteDialog.title)).toBeInTheDocument();
    expect(
      screen.getByText(modelsCopy.deleteDialog.description.replace("{{model}}", "Alpha")),
    ).toBeInTheDocument();

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: new RegExp(enCommon.actions.cancel) }),
    );
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("ai-model-delete-gpt-alpha"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: enCommon.actions.delete,
      }),
    );
    expect(onChange).toHaveBeenCalled();
  });

  it("marks a custom model and offers to restore the built-in list", () => {
    const onChange = renderManager({
      models: [{ id: "my-model", name: "My Model", enabled: true, source: "custom" }],
    });

    expect(screen.getByText(modelsCopy.custom)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ai-restore-models-openai"));
    expect(onChange).toHaveBeenCalled();
  });

  it("says the list is empty", () => {
    renderManager({ models: [] });

    expect(screen.getByText(modelsCopy.empty)).toBeInTheDocument();
  });

  it("dates a list that was refreshed long ago", () => {
    const then = Date.now() - 400 * 24 * HOUR;
    renderManager({ refreshedAt: then });

    expect(
      screen.getByText(modelsCopy.updated.replace("{{time}}", formatDate(then))),
    ).toBeInTheDocument();
  });
});

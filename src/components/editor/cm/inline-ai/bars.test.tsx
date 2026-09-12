// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import common from "@/i18n/locales/en/common.json" with { type: "json" };
import core from "@/i18n/locales/en/core.json" with { type: "json" };
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

vi.mock("@/components/ai/ModelSelector", () => ({
  ModelSelector: ({ modelId }: { modelId: string }) => <div data-testid="model">{modelId}</div>,
}));

import { DiffActionBar, DiffErrorBar } from "./DiffActionBar";
import { PromptPopover } from "./PromptPopover";

const inlineAi = en.inlineAi;

describe("DiffActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names accept, reject and retry and reports each choice", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onRetry = vi.fn();
    render(
      <DiffActionBar onAccept={onAccept} onReject={onReject} onRetry={onRetry} />,
    );

    expect(screen.getByLabelText(inlineAi.accept)).toHaveAttribute("aria-keyshortcuts", "Enter");
    expect(screen.getByLabelText(inlineAi.reject)).toHaveAttribute("aria-keyshortcuts", "Escape");
    expect(screen.queryByLabelText(inlineAi.openInAgent)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(inlineAi.accept));
    fireEvent.click(screen.getByLabelText(inlineAi.reject));
    fireEvent.click(screen.getByLabelText(inlineAi.retry));

    expect(onAccept).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers the agent handoff when the caller supports it", () => {
    const onOpenInAgent = vi.fn();
    render(
      <DiffActionBar
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onRetry={vi.fn()}
        onOpenInAgent={onOpenInAgent}
      />,
    );

    fireEvent.click(screen.getByLabelText(inlineAi.openInAgent));

    expect(onOpenInAgent).toHaveBeenCalledOnce();
  });
});

describe("DiffErrorBar", () => {
  it("explains the failure and offers a retry or a dismissal", () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(<DiffErrorBar message="The provider timed out." onRetry={onRetry} onDismiss={onDismiss} />);

    expect(
      screen.getByText(inlineAi.generateFailed.replace("{{message}}", "The provider timed out.")),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText(inlineAi.retry));
    fireEvent.click(screen.getByText(inlineAi.dismiss));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("PromptPopover", () => {
  const props = {
    instruction: "",
    onInstruction: vi.fn(),
    onSubmit: vi.fn(),
    onPreset: vi.fn(),
    onClose: vi.fn(),
    streaming: false,
    onStop: vi.fn(),
    providerId: "openai",
    modelId: "gpt-5",
    modelGroups: [],
    onModelChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for an instruction and offers every preset", () => {
    render(<PromptPopover {...props} />);

    const field = screen.getByRole("textbox");
    expect(field).toHaveAttribute("placeholder", inlineAi.promptPlaceholder);
    expect(field).toHaveFocus();
    expect(screen.getByLabelText(common.actions.close)).toBeInTheDocument();
    expect(screen.getByText(core.inlineAi.improve)).toBeInTheDocument();
    expect(screen.getByText(core.inlineAi.translate)).toBeInTheDocument();
    expect(screen.getByLabelText(inlineAi.submit)).toBeDisabled();

    fireEvent.change(field, { target: { value: "Tighten this" } });
    expect(props.onInstruction).toHaveBeenCalledWith("Tighten this");

    fireEvent.click(screen.getByText(core.inlineAi.concise));
    expect(props.onPreset).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText(common.actions.close));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("submits a filled instruction from the button and from Enter", () => {
    render(<PromptPopover {...props} instruction="Tighten this" />);

    fireEvent.click(screen.getByLabelText(inlineAi.submit));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(props.onSubmit).toHaveBeenCalledTimes(2);
  });

  it("keeps a newline out of the submission on Shift and Enter", () => {
    render(<PromptPopover {...props} instruction="Tighten this" />);

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      shiftKey: true,
    });

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("swaps the presets and the submit button for a stop control while streaming", () => {
    render(<PromptPopover {...props} instruction="Tighten this" streaming />);

    expect(screen.getByText(inlineAi.thinking)).toBeInTheDocument();
    expect(screen.queryByText(core.inlineAi.improve)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(inlineAi.submit)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(inlineAi.stop));
    expect(props.onStop).toHaveBeenCalledOnce();

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});

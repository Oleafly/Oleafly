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

  it("ignores the Enter that confirms an IME composition", () => {
    render(<PromptPopover {...props} instruction="翻訳して" />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", keyCode: 229 });

    expect(props.onSubmit).not.toHaveBeenCalled();
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

describe("PromptPopover saved instructions", () => {
  const saved = en.savedInstructions;
  const instructions = [
    { id: "keep", name: "Keep formatting", text: "Keep the formatting." },
    { id: "quotes", name: "Quotes", text: "Don't change quoted text." },
  ];
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
    saved: instructions,
    picked: [] as string[],
    onToggleSaved: vi.fn(),
    onSave: vi.fn(),
    onManage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the saved instructions as toggles and opens the manager", () => {
    render(<PromptPopover {...props} picked={["quotes"]} />);

    const group = screen.getByRole("group", { name: saved.label });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep formatting" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Quotes" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Keep formatting" }));
    expect(props.onToggleSaved).toHaveBeenCalledWith("keep");

    fireEvent.click(screen.getByRole("button", { name: saved.manage }));
    expect(props.onManage).toHaveBeenCalledOnce();
  });

  it("submits with only a picked instruction and nothing typed", () => {
    const { rerender } = render(<PromptPopover {...props} />);
    expect(screen.getByLabelText(inlineAi.submit)).toBeDisabled();

    rerender(<PromptPopover {...props} picked={["keep"]} />);
    expect(screen.getByLabelText(inlineAi.submit)).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("names and saves the typed instruction, or cancels back to the prompt", () => {
    const { rerender } = render(
      <PromptPopover {...props} saved={[]} instruction="Keep the original formatting and don't change quotes" canSave />,
    );
    expect(screen.queryByRole("button", { name: saved.manage })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: saved.save }));
    const name = screen.getByRole("textbox", { name: saved.nameLabel });
    expect(name).toHaveFocus();
    expect(name).toHaveValue("Keep the original formatting and");

    fireEvent.keyDown(name, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: saved.nameLabel })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(props.onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: saved.save }));
    fireEvent.change(screen.getByRole("textbox", { name: saved.nameLabel }), { target: { value: "  Keep  " } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: saved.nameLabel }), { key: "Enter" });
    expect(props.onSave).toHaveBeenCalledWith("Keep");
    expect(props.onSubmit).not.toHaveBeenCalled();

    rerender(<PromptPopover {...props} instruction="Already saved" canSave={false} />);
    expect(screen.queryByRole("button", { name: saved.save })).not.toBeInTheDocument();
  });

  it("refuses an empty name", () => {
    render(<PromptPopover {...props} instruction="Keep it" canSave />);
    fireEvent.click(screen.getByRole("button", { name: saved.save }));
    fireEvent.change(screen.getByRole("textbox", { name: saved.nameLabel }), { target: { value: "  " } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: saved.nameLabel }), { key: "Enter" });
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: common.actions.save })).toBeDisabled();
  });

  it("suggests the most used five and keeps a picked one in view", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `i${index}`, name: `Rule ${index}`, text: `Text ${index}` }));
    render(<PromptPopover {...props} saved={many} picked={["i7"]} />);

    expect(screen.getByRole("button", { name: "Rule 4" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rule 5" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rule 7" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: saved.more_other.replace("{{count}}", "2") }));
    expect(screen.getByRole("button", { name: "Rule 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rule 6" })).toBeInTheDocument();
  });

  it("hides the saved instructions while streaming", () => {
    render(<PromptPopover {...props} streaming />);
    expect(screen.queryByRole("group", { name: saved.label })).not.toBeInTheDocument();
  });
});

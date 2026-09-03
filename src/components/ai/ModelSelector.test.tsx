// @vitest-environment jsdom

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelSelector } from "./ModelSelector";

Element.prototype.scrollIntoView = vi.fn();

const groups = [
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: [{ id: "claude-sonnet", name: "Claude Sonnet" }],
  },
];

describe("ModelSelector", () => {
  it("keeps the selected model name in its tooltip when the label collapses", async () => {
    render(
      <ModelSelector
        compact
        providerId="openai"
        modelId="gpt-5.6-luna"
        groups={groups}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "AI model" });
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "GPT-5.6 Luna. Switch provider or model",
    );
  });

  it("opens from an external command and reports when the picker closes", () => {
    function ControlledPicker() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open model picker
          </button>
          <ModelSelector
            open={open}
            onOpenChange={setOpen}
            providerId="openai"
            modelId="gpt-5.6-luna"
            groups={groups}
            onChange={() => {}}
          />
        </>
      );
    }

    render(<ControlledPicker />);
    fireEvent.click(screen.getByRole("button", { name: "Open model picker" }));
    const search = screen.getByRole("combobox", { name: "Search models" });
    expect(search).toBeInTheDocument();
    expect(search).toHaveFocus();
    expect(search.closest("[data-state='open']")).toHaveClass("z-[80]");

    fireEvent.click(screen.getByText("GPT-5.6 Sol"));
    expect(screen.queryByRole("combobox", { name: "Search models" })).not.toBeInTheDocument();
  });

  it("centers compact model controls without full-size vertical padding", () => {
    render(
      <ModelSelector
        compact
        providerId="openai"
        modelId="gpt-5.6-luna"
        groups={groups}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "AI model" })).toHaveClass(
      "items-center",
      "py-0",
      "leading-none",
    );
  });

  it("filters by model name or provider and handles an empty result", () => {
    render(
      <ModelSelector
        providerId="openai"
        modelId="gpt-5.6-luna"
        groups={groups}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "AI model" }));
    const search = screen.getByRole("combobox", { name: "Search models" });

    fireEvent.change(search, { target: { value: "sonnet" } });
    expect(screen.getByText("Claude Sonnet")).toBeInTheDocument();
    expect(screen.queryByText("GPT-5.6 Sol")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "not-a-model" } });
    expect(screen.getByText("No models found")).toBeInTheDocument();
    expect(screen.getByText("Try a different search.")).toBeInTheDocument();
  });

  it("shows trust badges and capability chips beside each model", () => {
    render(
      <ModelSelector
        providerId="openai"
        modelId="gpt-5.6-luna"
        groups={[
          {
            id: "openai",
            name: "OpenAI",
            models: [
              {
                id: "gpt-5.6-luna",
                name: "GPT-5.6 Luna",
                trust: "verified",
                metadata: {
                  name: "GPT-5.6 Luna",
                  contextWindow: 128000,
                  inputModalities: ["text", "image"],
                  outputModalities: ["text"],
                  toolCall: true,
                  reasoning: true,
                  attachment: true,
                  structuredOutput: true,
                  status: "deprecated",
                },
              },
              { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", trust: "untested" },
              { id: "plain", name: "Plain" },
            ],
          },
        ]}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "AI model" }));

    expect(screen.getByTestId("ai-model-trust-verified")).toHaveTextContent("Verified");
    expect(screen.getByTestId("ai-model-trust-untested")).toHaveTextContent("Untested");
    expect(screen.getByTestId("ai-model-chip-context")).toHaveTextContent("128k");
    expect(screen.getByTestId("ai-model-chip-vision")).toHaveTextContent("Vision");
    expect(screen.getByTestId("ai-model-chip-tools")).toHaveTextContent("Tools");
    expect(screen.getByTestId("ai-model-chip-reasoning")).toHaveTextContent("Reasoning");
    expect(screen.getByTestId("ai-model-chip-deprecated")).toHaveTextContent("Deprecated");
    expect(screen.queryByTestId("ai-model-trust-blocked")).not.toBeInTheDocument();

    const luna = screen.getByTestId("ai-model-option-openai-gpt-5.6-luna");
    expect(luna).toHaveAccessibleName(/Accepts images/);
    expect(luna).toHaveAccessibleName(/Can call tools/);
    expect(luna).toHaveAccessibleName(/The provider has deprecated this model/);
    expect(luna).not.toHaveAccessibleName(/128k/);
  });

  it("keeps a blocked model visible but not selectable, with its reason", async () => {
    const onChange = vi.fn();
    render(
      <ModelSelector
        providerId="openai"
        modelId="gpt-5.6-luna"
        groups={[
          {
            id: "openai",
            name: "OpenAI",
            models: [
              { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", trust: "verified" },
              {
                id: "gpt-5.6-sol",
                name: "GPT-5.6 Sol",
                trust: "blocked",
                blockedReason: "Its thinking output breaks the assistant loop.",
              },
            ],
          },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "AI model" }));
    const blocked = screen.getByTestId("ai-model-option-openai-gpt-5.6-sol");
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveAccessibleName(
      /Blocked\. Its thinking output breaks the assistant loop\./,
    );

    fireEvent.click(screen.getByText("GPT-5.6 Sol"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Search models" })).toBeInTheDocument();

    const badge = screen.getByTestId("ai-model-trust-blocked");
    fireEvent.mouseEnter(badge.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Its thinking output breaks the assistant loop.",
    );
  });

  it("selects a filtered model and closes the picker", () => {
    const onChange = vi.fn();
    render(
      <ModelSelector
        providerId="openai"
        modelId="gpt-5.6-luna"
        groups={groups}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "AI model" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search models" }), {
      target: { value: "sol" },
    });
    fireEvent.click(screen.getByText("GPT-5.6 Sol"));

    expect(onChange).toHaveBeenCalledWith("openai", "gpt-5.6-sol");
    expect(
      screen.queryByRole("combobox", { name: "Search models" }),
    ).not.toBeInTheDocument();
  });
});

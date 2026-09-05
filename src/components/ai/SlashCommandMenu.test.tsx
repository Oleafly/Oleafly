// @vitest-environment jsdom

import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Circle } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import type { ComposerCommand } from "./composer-command-registry";
import {
  filterSlashCommands,
  isSlashCommandInput,
  SlashCommandMenu,
  type SlashCommandMenuHandle,
} from "./SlashCommandMenu";

function command(id: string, label: string, description: string, action: () => void): ComposerCommand {
  return { id, label, description, icon: Circle, action };
}

const keyEvent = (key: string) => ({ key, preventDefault: () => {} });

describe("SlashCommandMenu", () => {
  it("only recognizes a slash token at the start of the composer", () => {
    expect(isSlashCommandInput("/")).toBe(true);
    expect(isSlashCommandInput("/plan")).toBe(true);
    expect(isSlashCommandInput(" /plan")).toBe(false);
    expect(isSlashCommandInput("Please /plan this")).toBe(false);
    expect(isSlashCommandInput("/plan\nnext")).toBe(false);
  });

  it("filters commands by their label and description", () => {
    render(
      <SlashCommandMenu
        commands={[
          command("goal", "Goal", "Set a persistent target", () => {}),
          command("model", "Model", "Choose the model for this chat", () => {}),
          command("plan", "Plan mode", "Turn structured planning on or off", () => {}),
        ]}
        query="choose model"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("option", { name: /Model/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Goal/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Plan mode/ })).not.toBeInTheDocument();
  });

  it("finds a skill by its id and heads its group once", () => {
    const skillCommand: ComposerCommand = {
      id: "skill:paper-lookup",
      label: "Paper Lookup",
      description: "Search literature APIs.",
      icon: Circle,
      kind: "insert",
      insertText: "/paper-lookup ",
      group: "Skills",
      keywords: "paper-lookup",
      action: () => {},
    };
    render(
      <SlashCommandMenu
        commands={[
          command("model", "Model", "Choose the model for this chat", () => {}),
          skillCommand,
          { ...skillCommand, id: "skill:peer-review", label: "Peer Review", keywords: "peer-review" },
        ]}
        query=""
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getAllByText("Skills")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Paper Lookup/ })).toBeInTheDocument();
  });

  it("matches a skill typed by id rather than by name", () => {
    const skillCommand: ComposerCommand = {
      id: "skill:paper-lookup",
      label: "Paper Lookup",
      description: "Search literature APIs.",
      icon: Circle,
      kind: "insert",
      insertText: "/paper-lookup ",
      group: "Skills",
      keywords: "paper-lookup",
      action: () => {},
    };
    const selected: ComposerCommand[] = [];
    const ref = createRef<SlashCommandMenuHandle>();
    render(
      <SlashCommandMenu
        ref={ref}
        commands={[command("model", "Model", "Choose a model", () => {}), skillCommand]}
        query="paper-look"
        onSelect={(item) => selected.push(item)}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByRole("option", { name: /Model/ })).not.toBeInTheDocument();
    act(() => ref.current?.handleKeyDown(keyEvent("Enter")));

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ kind: "insert", insertText: "/paper-lookup " });
  });

  it("moves the active command with arrow keys and selects it with Enter", () => {
    const selected: string[] = [];
    const ref = createRef<SlashCommandMenuHandle>();
    render(
      <SlashCommandMenu
        ref={ref}
        commands={[
          command("goal", "Goal", "Set a goal", () => selected.push("goal-action")),
          command("model", "Model", "Choose a model", () => selected.push("model-action")),
        ]}
        query=""
        onSelect={(item) => selected.push(item.id)}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("option", { name: /Goal/ })).toHaveAttribute("aria-selected", "true");
    act(() => ref.current?.handleKeyDown(keyEvent("ArrowDown")));
    expect(screen.getByRole("option", { name: /Model/ })).toHaveAttribute("aria-selected", "true");
    act(() => ref.current?.handleKeyDown(keyEvent("Enter")));

    expect(selected).toEqual(["model-action", "model"]);
  });

  it("wraps to the last command with ArrowUp", () => {
    const ref = createRef<SlashCommandMenuHandle>();
    render(
      <SlashCommandMenu
        ref={ref}
        commands={[
          command("goal", "Goal", "Set a goal", () => {}),
          command("model", "Model", "Choose a model", () => {}),
        ]}
        query=""
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    act(() => ref.current?.handleKeyDown(keyEvent("ArrowUp")));

    expect(screen.getByRole("option", { name: /Model/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("lets Enter send the message when no command matches", () => {
    const action = vi.fn();
    const preventDefault = vi.fn();
    const ref = createRef<SlashCommandMenuHandle>();
    render(
      <SlashCommandMenu
        ref={ref}
        commands={[command("goal", "Goal", "Set a goal", action)]}
        query="nothing-matches"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(ref.current?.handleKeyDown({ key: "Enter", preventDefault })).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it("renders nothing at all when no command matches", () => {
    const { container } = render(
      <SlashCommandMenu
        commands={[command("goal", "Goal", "Set a goal", () => {})]}
        query="nothing-matches"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("No matching commands")).toBeNull();
  });

  it("leaves the arrow and escape keys to the composer when nothing matches", () => {
    const onClose = vi.fn();
    const ref = createRef<SlashCommandMenuHandle>();
    render(
      <SlashCommandMenu
        ref={ref}
        commands={[command("goal", "Goal", "Set a goal", () => {})]}
        query="nothing-matches"
        onSelect={() => {}}
        onClose={onClose}
      />,
    );

    expect(ref.current?.handleKeyDown(keyEvent("ArrowDown"))).toBe(false);
    expect(ref.current?.handleKeyDown(keyEvent("Escape"))).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("filters a command list the same way the menu does", () => {
    const commands = [
      command("goal", "Goal", "Set a persistent target", () => {}),
      command("model", "Model", "Choose the model for this chat", () => {}),
    ];

    expect(filterSlashCommands(commands, "")).toHaveLength(2);
    expect(filterSlashCommands(commands, "model").map((item) => item.id)).toEqual(["model"]);
    expect(filterSlashCommands(commands, "nothing-matches")).toEqual([]);
  });

  it("keeps virtual-focus options out of the tab order", () => {
    const ref = createRef<SlashCommandMenuHandle>();
    render(
      <SlashCommandMenu
        ref={ref}
        commands={[
          command("goal", "Goal", "Set a goal", () => {}),
          command("model", "Model", "Choose a model", () => {}),
        ]}
        query=""
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveAttribute("tabindex", "-1");
    }
    act(() => ref.current?.handleKeyDown(keyEvent("ArrowDown")));
    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveAttribute("tabindex", "-1");
    }
  });

  it.each([
    {
      label: "IME composition",
      event: {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
        preventDefault: vi.fn(),
      },
    },
    {
      label: "Shift+Enter",
      event: {
        key: "Enter",
        shiftKey: true,
        nativeEvent: { isComposing: false },
        preventDefault: vi.fn(),
      },
    },
  ])("does not select a command during $label", ({ event }) => {
    const action = vi.fn();
    const ref = createRef<SlashCommandMenuHandle>();
    render(
      <SlashCommandMenu
        ref={ref}
        commands={[command("goal", "Goal", "Set a goal", action)]}
        query=""
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(ref.current?.handleKeyDown(event)).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("closes on Escape and selects a clicked command", () => {
    const events: string[] = [];
    const ref = createRef<SlashCommandMenuHandle>();
    render(
      <SlashCommandMenu
        ref={ref}
        commands={[command("goal", "Goal", "Set a goal", () => events.push("action"))]}
        query=""
        onSelect={(item) => events.push(item.id)}
        onClose={() => events.push("close")}
      />,
    );

    act(() => ref.current?.handleKeyDown(keyEvent("Escape")));
    fireEvent.click(screen.getByRole("option", { name: /Goal/ }));

    expect(events).toEqual(["close", "action", "goal"]);
  });
});

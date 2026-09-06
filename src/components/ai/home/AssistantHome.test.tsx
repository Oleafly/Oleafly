// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SkillEntry } from "@/lib/skills";
import type { StoredChat } from "@/store/chats";
import { AssistantHome } from "./AssistantHome";
import { AgentPickerRow } from "./AgentPickerRow";
import { RecentChats } from "./RecentChats";

function skill(id: string, overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id,
    name: id.replace(/-/g, " "),
    description: `What ${id} does.`,
    instructions: "",
    dir: `/skills/${id}`,
    files: [],
    allowedTools: [],
    tier: "native",
    phase: "research",
    tools: [],
    source: "bundled",
    updateAvailable: false,
    projectEnabled: false,
    enabled: true,
    removable: false,
    validation: { status: "valid" },
    ...overrides,
  };
}

function chat(id: string, overrides: Partial<StoredChat> = {}): StoredChat {
  return {
    id,
    projectId: "paper",
    title: `Chat ${id}`,
    createdAt: 1,
    updatedAt: Date.UTC(2026, 8, 5),
    messages: [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ],
    headOid: "head",
    ...overrides,
  } as StoredChat;
}

describe("AssistantHome", () => {
  it("groups skills into category tabs and runs the picked skill", () => {
    const onPickSkill = vi.fn();
    render(
      <AssistantHome
        skills={[
          skill("brainstorming"),
          skill("systematic-debugging"),
          skill("writing-skills"),
          skill("receiving-code-review"),
          skill("finish-branch", { phase: "review" }),
        ]}
        onPickSkill={onPickSkill}
      />,
    );

    expect(screen.getByTestId("assistant-home")).toHaveTextContent("What would you like to do today?");
    expect(screen.getByTestId("assistant-home-tab-research")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("assistant-home-cards").children).toHaveLength(3);
    expect(screen.getByTestId("assistant-home-chip-writing-skills")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("assistant-home-card-brainstorming"));
    expect(onPickSkill).toHaveBeenCalledWith(expect.objectContaining({ id: "brainstorming" }));

    fireEvent.click(screen.getByTestId("assistant-home-tab-review"));
    expect(screen.getByTestId("assistant-home-card-finish-branch")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-home-card-brainstorming")).not.toBeInTheDocument();
  });

  it("sends a skill turned off for this project to settings instead of running it", () => {
    const onPickSkill = vi.fn();
    const onOpenSkills = vi.fn();
    render(
      <AssistantHome
        skills={[skill("locked-skill", { enabled: false, projectDisabled: true })]}
        onPickSkill={onPickSkill}
        onOpenSkills={onOpenSkills}
      />,
    );
    const card = screen.getByTestId("assistant-home-card-locked-skill");
    expect(card).toHaveAttribute("data-locked", "true");
    fireEvent.click(card);
    expect(onOpenSkills).toHaveBeenCalledOnce();
    expect(onPickSkill).not.toHaveBeenCalled();
  });

  it("hides invalid skills and drops the tab strip when one category remains", () => {
    render(
      <AssistantHome
        skills={[
          skill("good"),
          skill("broken", {
            validation: { status: "invalid", code: "missing-name", message: "no name" },
          }),
        ]}
        onPickSkill={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("assistant-home-card-broken")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("puts the quick starts in the same slider as the overflow skills", () => {
    const onSelect = vi.fn();
    render(
      <AssistantHome
        skills={[
          skill("alpha"),
          skill("beta"),
          skill("gamma"),
          skill("delta"),
        ]}
        onPickSkill={vi.fn()}
        quickStarts={[{ id: "recompile", label: "Recompile and check for errors", onSelect }]}
      />,
    );
    const slider = screen.getByTestId("assistant-home-chips");
    const labels = [...slider.querySelectorAll("button")].map((node) => node.textContent);
    expect(labels).toEqual(["gamma", "Recompile and check for errors"]);
    fireEvent.click(screen.getByTestId("chat-suggestion"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("colors cards and slider entries from one rotating palette", () => {
    render(
      <AssistantHome
        skills={[skill("alpha"), skill("beta"), skill("gamma"), skill("delta")]}
        onPickSkill={vi.fn()}
        quickStarts={[{ id: "recompile", label: "Recompile", onSelect: vi.fn() }]}
      />,
    );
    expect(screen.getByTestId("assistant-home-card-alpha").className).toContain("border-amber-500/60");
    expect(screen.getByTestId("assistant-home-card-beta").className).toContain("border-rose-500/60");
    expect(screen.getByTestId("assistant-home-card-delta").className).toContain("border-violet-500/60");
    expect(screen.getByTestId("assistant-home-chip-gamma").className).toContain("border-sky-500/60");
    expect(screen.getByTestId("chat-suggestion").className).toContain("border-emerald-500/60");
    expect(screen.getByTestId("chat-suggestion").className).not.toContain("text-primary");
  });
});

describe("RecentChats", () => {
  it("lists the newest chats with counts and marks a stale one", () => {
    const onOpen = vi.fn();
    const onShowAll = vi.fn();
    render(
      <RecentChats
        chats={[chat("a"), chat("b", { headOid: "older" }), chat("c"), chat("d")]}
        currentHead="head"
        onOpen={onOpen}
        onShowAll={onShowAll}
      />,
    );
    expect(screen.getByTestId("recent-chats-count")).toHaveTextContent("4");
    expect(screen.getByTestId("recent-chats-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Chat a")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("recent-chats-toggle"));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Chat a")).toBeInTheDocument();
    expect(screen.queryByText("Chat d")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Older version")).toBeInTheDocument();
    expect(screen.getAllByText("2 msgs")).toHaveLength(3);

    fireEvent.click(screen.getByText("Chat a"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    fireEvent.click(screen.getByText("Show all history (4)"));
    expect(onShowAll).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId("recent-chats-toggle"));
    expect(screen.getByTestId("recent-chats-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Chat a")).not.toBeInTheDocument();
    expect(screen.getByTestId("recent-chats-count")).toHaveTextContent("4");
  });

  it("renders nothing without chats", () => {
    const { container } = render(
      <RecentChats chats={[]} currentHead={null} onOpen={vi.fn()} onShowAll={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AgentPickerRow", () => {
  it("names the selected agent, dims the unavailable ones, and reports the choice", () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerRow
        agents={[
          { id: "claude", name: "Claude Code", available: true },
          { id: "pi", name: "Pi", available: false, hint: "CLI not found on this computer" },
        ]}
        selectedId="claude"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByTestId("agent-picker-claude")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("agent-picker-claude")).toHaveTextContent("Claude Code");
    expect(screen.getByTestId("agent-picker-pi")).toHaveAttribute("data-available", "false");
    fireEvent.click(screen.getByTestId("agent-picker-pi"));
    expect(onSelect).toHaveBeenCalledWith("pi");
  });
});

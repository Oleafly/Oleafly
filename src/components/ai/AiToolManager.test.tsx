// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiToolSettingsStore } from "@/store/ai-tool-settings";
import type { AvailableToolGroup } from "@/lib/ai-tool-availability";
import { AiToolManager } from "./AiToolManager";

const GROUPS: AvailableToolGroup[] = [
  {
    id: "project",
    label: "Project tools",
    tools: [
      { name: "read_file", description: "Read a file's contents" },
      { name: "compile", description: "Compile the project to PDF" },
    ],
  },
  {
    id: "mcp:papers",
    label: "MCP",
    server: "Papers",
    tools: [{ name: "search_papers", description: "Search the connected papers server" }],
  },
  {
    id: "skills",
    label: "Skills",
    tools: [{ name: "load_skill", description: "Load an enabled skill" }],
  },
  {
    id: "figure",
    label: "Figure",
    tools: [{ name: "preview_figure", description: "" }],
  },
];

beforeEach(() => {
  localStorage.clear();
  useAiToolSettingsStore.setState({ enabledByName: {} });
});

afterEach(() => cleanup());

describe("AI tool manager", () => {
  it("renders every available tool under its source with an enabled switch", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<AiToolManager groups={GROUPS} onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "Manage agent tools" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Tools" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tools" })).toBeVisible();
    expect(screen.getByText("5 of 5 enabled")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("heading", { name: "Project tools" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "MCP Papers" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Figure" })).toBeVisible();
    expect(screen.getByText("Search the connected papers server")).toBeVisible();
    expect(screen.getByText("No description provided.")).toBeVisible();
    expect(screen.getByText("search_papers")).toHaveAttribute("title", "search_papers");
    expect(screen.getAllByRole("switch")).toHaveLength(5);
    expect(screen.getByRole("switch", { name: "Enable search_papers" })).toBeChecked();
  });

  it("persists individual choices and keeps the popover open", async () => {
    const user = userEvent.setup();
    render(<AiToolManager groups={GROUPS} />);
    await user.click(screen.getByRole("button", { name: "Manage agent tools" }));

    const toggle = screen.getByRole("switch", { name: "Enable compile" });
    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(screen.getByText("4 of 5 enabled")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tools" })).toBeVisible();
    expect(useAiToolSettingsStore.getState().enabledByName.compile).toBe(false);
  });

  it("disables and enables all currently available tools", async () => {
    const user = userEvent.setup();
    useAiToolSettingsStore.getState().setToolEnabled("temporarily_unavailable", false);
    render(<AiToolManager groups={GROUPS} />);
    await user.click(screen.getByRole("button", { name: "Manage agent tools" }));

    await user.click(screen.getByRole("button", { name: "Disable all" }));
    for (const toggle of screen.getAllByRole("switch")) expect(toggle).not.toBeChecked();
    expect(screen.getByText("0 of 5 enabled")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Enable all" }));
    for (const toggle of screen.getAllByRole("switch")) expect(toggle).toBeChecked();
    expect(useAiToolSettingsStore.getState().enabledByName.temporarily_unavailable).toBe(false);
  });

  it("closes with Escape and restores focus to the wrench", async () => {
    const user = userEvent.setup();
    render(<AiToolManager groups={GROUPS} />);
    const trigger = screen.getByRole("button", { name: "Manage agent tools" });
    await user.click(trigger);

    const popover = screen.getByTestId("ai-tool-manager");
    expect(within(popover).getByRole("heading", { name: "Tools" })).toBeVisible();
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("ai-tool-manager")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

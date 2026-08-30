// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { Circle } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { ComposerCommand } from "./composer-command-registry";
import { ComposerAttachMenu } from "./ComposerAttachMenu";

function commands(calls: string[]): ComposerCommand[] {
  return [
    { id: "files", label: "Files", description: "Attach files", icon: Circle, action: () => calls.push("files") },
    { id: "browser", label: "Attach browser", description: "Open browser", icon: Circle, action: () => calls.push("browser") },
    { id: "goal", label: "Goal", description: "Set goal", icon: Circle, action: () => calls.push("goal") },
    { id: "plan-mode", label: "Plan mode", description: "Toggle planning", icon: Circle, action: () => calls.push("plan-mode") },
  ];
}

function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Add context" }), {
    button: 0,
    ctrlKey: false,
  });
}

describe("ComposerAttachMenu", () => {
  it("opens the plus menu with every available action", () => {
    render(<ComposerAttachMenu commands={commands([])} />);

    openMenu();

    expect(screen.getByRole("menuitem", { name: /Files/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Attach browser/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Goal/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Plan mode/ })).toBeInTheDocument();
  });

  it("renders the portaled menu above the floating assistant", () => {
    render(<ComposerAttachMenu commands={commands([])} />);

    openMenu();

    expect(screen.getByRole("menu")).toHaveClass("z-[80]");
  });

  it.each([
    ["Files", "files"],
    ["Attach browser", "browser"],
    ["Goal", "goal"],
    ["Plan mode", "plan-mode"],
  ] as const)("dispatches %s from the plus menu", (label, expected) => {
    const calls: string[] = [];
    render(<ComposerAttachMenu commands={commands(calls)} />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(label) }));

    expect(calls).toEqual([expected]);
  });
});

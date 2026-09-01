// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { createAppQueryClient } from "@/lib/query";
import type { SkillEntry } from "@/lib/skills";
import { SkillsTab } from "./SkillsTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: vi.fn() }));

const ENABLED: SkillEntry = {
  id: "research-review",
  name: "Research Review",
  description: "Review a manuscript like a careful referee.",
  instructions: "Read the manuscript and report the main issues.",
  source: "first-party",
  enabled: true,
  removable: false,
  validation: { status: "valid" },
};

const DISABLED: SkillEntry = {
  id: "methods-coach",
  name: "Methods Coach",
  description: "Check a methods section for reproducibility.",
  instructions: "Read the methods section and list missing details.",
  source: "user",
  enabled: false,
  removable: true,
  validation: { status: "valid" },
};

const INVALID: SkillEntry = {
  id: "broken",
  name: "broken",
  description: "",
  instructions: "Add a description before using this draft.",
  source: "user",
  enabled: false,
  removable: true,
  validation: {
    status: "invalid",
    code: "missing-description",
    message: 'SKILL.md is missing the front matter field "description".',
  },
};

const mockInvoke = vi.mocked(invoke);
const mockPickOpenPath = vi.mocked(pickOpenPath);
let records: SkillEntry[];

function renderTab() {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <SkillsTab />
    </QueryClientProvider>,
  );
}

describe("SkillsTab", () => {
  beforeEach(() => {
    records = [ENABLED, DISABLED, INVALID];
    mockPickOpenPath.mockReset();
    mockInvoke.mockReset().mockImplementation(async (command, args) => {
      if (command === "skills_list") return records;
      if (command === "skills_set_enabled") {
        const input = args as { id: string; enabled: boolean };
        const current = records.find((skill) => skill.id === input.id);
        if (!current) throw new Error(`Unknown skill: ${input.id}`);
        const next = { ...current, enabled: input.enabled };
        records = records.map((skill) => (skill.id === input.id ? next : skill));
        return next;
      }
      if (command === "skills_add") {
        const next = { ...DISABLED, id: "imported", name: "Imported Skill" };
        records = [...records, next];
        return next;
      }
      if (command === "skills_create") {
        const input = (args as { input: { name: string; description: string; instructions?: string } }).input;
        const next: SkillEntry = {
          ...DISABLED,
          id: "new-skill",
          name: input.name,
          description: input.description,
          instructions: input.instructions ?? "",
        };
        records = [...records, next];
        return next;
      }
      if (command === "skills_update") {
        const input = (args as { id: string; input: { name: string; description: string; instructions: string } });
        const next: SkillEntry = {
          ...DISABLED,
          id: input.id,
          name: input.input.name,
          description: input.input.description,
          instructions: input.input.instructions,
        };
        records = records.map((skill) => (skill.id === input.id ? next : skill));
        return next;
      }
      if (command === "skills_validate") {
        const next: SkillEntry = {
          ...INVALID,
          description: "A repaired draft.",
          validation: { status: "valid" },
        };
        records = records.map((skill) => (skill.id === next.id ? next : skill));
        return next;
      }
      if (command === "skills_remove") {
        const input = args as { id: string };
        records = records.filter((skill) => skill.id !== input.id);
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("lists source and enable state while surfacing invalid skill errors", async () => {
    renderTab();

    expect(await screen.findByText("Research Review")).toBeInTheDocument();
    expect(screen.getByText("Built in")).toBeInTheDocument();
    expect(screen.getAllByText("Added")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Enable Research Review" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Enable Methods Coach" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Enable broken" })).toBeDisabled();
    expect(
      screen.getByText('SKILL.md is missing the front matter field "description".'),
    ).toBeInTheDocument();
  });

  it("persists a skill toggle and refreshes the shared list", async () => {
    renderTab();
    await screen.findByText("Methods Coach");

    fireEvent.click(screen.getByRole("switch", { name: "Enable Methods Coach" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_set_enabled", {
        id: "methods-coach",
        enabled: true,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Enable Methods Coach" })).toBeChecked(),
    );
  });

  it("adds a selected skill folder", async () => {
    mockPickOpenPath.mockResolvedValue("/tmp/imported-skill");
    renderTab();
    await screen.findByText("Research Review");

    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_add", {
        sourcePath: "/tmp/imported-skill",
      }),
    );
    expect(await screen.findByText("Imported Skill")).toBeInTheDocument();
  });

  it("creates a disabled skill from the editor", async () => {
    renderTab();
    await screen.findByText("Research Review");
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Claim Checker" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Check whether each claim has support." },
    });
    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Read every claim and find its supporting citation." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_create", {
        input: {
          name: "Claim Checker",
          description: "Check whether each claim has support.",
          instructions: "Read every claim and find its supporting citation.",
        },
      }),
    );
    expect(await screen.findByRole("switch", { name: "Enable Claim Checker" })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Created Claim Checker.");
  });

  it("validates an invalid skill and edits it in place", async () => {
    renderTab();
    await screen.findByText("broken");

    fireEvent.click(screen.getByRole("button", { name: "Validate broken" }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_validate", { id: "broken" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Enable broken" })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit broken" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Draft Reviewer" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Review a saved draft." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        "skills_update",
        expect.objectContaining({
          id: "broken",
          input: expect.objectContaining({ name: "Draft Reviewer" }),
        }),
      ),
    );
    expect(await screen.findByText("Draft Reviewer")).toBeInTheDocument();
  });

  it("removes a user skill after confirmation", async () => {
    renderTab();
    await screen.findByText("Methods Coach");

    fireEvent.click(screen.getByRole("button", { name: "Remove Methods Coach" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Remove skill" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_remove", { id: "methods-coach" }),
    );
    await waitFor(() => expect(screen.queryByText("Methods Coach")).not.toBeInTheDocument());
  });
});

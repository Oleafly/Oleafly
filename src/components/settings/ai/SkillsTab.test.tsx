// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { pickOpenPath } from "@/lib/native-file-dialog";
import { createAppQueryClient } from "@/lib/query";
import type { SkillCatalog, SkillShareTarget } from "@/lib/tauri";
import type { SkillEntry } from "@/lib/skills";
import { SkillsTab } from "./SkillsTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: vi.fn() }));

const mocks = vi.hoisted(() => ({ projectId: null as string | null }));

const copy = enSettings.ai.skills;

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{{${key}}}`, value),
    template,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const enableName = (name: string) => fill(copy.useInAllProjectsAria, { name });
const projectName = (name: string) => fill(copy.useInProjectAria, { name });

vi.mock("@/store/files", () => ({
  useFilesStore: (selector: (state: { projectId: string | null }) => unknown) =>
    selector({ projectId: mocks.projectId }),
}));

const RESEARCH_SKILL: SkillEntry = {
  id: "paper-lookup",
  name: "Paper Lookup",
  description: "Find papers that support a claim.",
  instructions: "Search the literature and cite what you find.",
  dir: "/skills/paper-lookup",
  files: [
    { path: "SKILL.md", bytes: 1200 },
    { path: "references/checklist.md", bytes: 400 },
  ],
  license: "MIT",
  compatibility: null,
  allowedTools: [],
  version: "2026.09.04",
  author: "Scientific Agent Skills",
  tier: "vendored",
  phase: "research",
  tools: [],
  source: "bundled",
  packVersion: "2026.09.04",
  updateAvailable: false,
  projectEnabled: false,
  enabled: true,
  removable: false,
  validation: { status: "valid" },
};

const METHODS_COACH: SkillEntry = {
  id: "methods-coach",
  name: "Methods Coach",
  description: "Check a methods section for reproducibility.",
  instructions: "Read the methods section and list missing details.",
  dir: "/skills/methods-coach",
  files: [],
  license: null,
  compatibility: null,
  allowedTools: [],
  version: null,
  author: null,
  tier: "user",
  phase: null,
  tools: [],
  source: "user",
  packVersion: null,
  updateAvailable: false,
  projectEnabled: false,
  enabled: false,
  removable: true,
  validation: { status: "valid" },
};

const INVALID: SkillEntry = {
  id: "broken",
  name: "broken",
  description: "",
  instructions: "Add a description before using this draft.",
  dir: "/skills/broken",
  files: [],
  license: null,
  compatibility: null,
  allowedTools: [],
  version: null,
  author: null,
  tier: "user",
  phase: null,
  tools: [],
  source: "user",
  packVersion: null,
  updateAvailable: false,
  projectEnabled: false,
  enabled: false,
  removable: true,
  validation: {
    status: "invalid",
    code: "missing-description",
    message: 'SKILL.md is missing the front matter field "description".',
  },
};

const STALE_BUILTIN: SkillEntry = {
  id: "oleafly-research-loop",
  name: "Research Loop",
  description: "Coordinate a research task end to end.",
  instructions: "Plan, gather sources, draft, and verify.",
  dir: "/skills/oleafly-research-loop",
  files: [],
  license: null,
  compatibility: null,
  allowedTools: [],
  version: "2026.08.01",
  author: null,
  tier: "native",
  phase: "research",
  tools: [],
  source: "bundled",
  packVersion: "2026.08.01",
  updateAvailable: true,
  projectEnabled: false,
  enabled: true,
  removable: false,
  validation: { status: "valid" },
};

const SHELF_SKILL: SkillEntry = {
  id: "genomics-toolkit",
  name: "Genomics Toolkit",
  description: "Helpers for genomics-specific analysis.",
  instructions: "Run the genomics scripts and report the results.",
  dir: "/skills/genomics-toolkit",
  files: [],
  license: "MIT",
  compatibility: null,
  allowedTools: [],
  version: "1.0.0",
  author: null,
  tier: "shelf",
  phase: "research",
  tools: [],
  source: "catalog",
  packVersion: null,
  updateAvailable: false,
  projectEnabled: false,
  enabled: false,
  removable: true,
  validation: { status: "valid" },
};

const EMPTY_CATALOG: SkillCatalog = {
  source: "bundled",
  generatedAt: "2026-09-01T00:00:00Z",
  skills: [],
};

const SHELF_ENTRY = {
  id: "genomics-toolkit",
  name: "Genomics Toolkit",
  description: "Helpers for genomics-specific analysis.",
  phase: "research",
  domain: "genomics",
  license: "MIT",
  version: "1.0.0",
  bytes: 128_000,
  files: 4,
  bundled: false,
  installed: false,
  updateAvailable: false,
};

const SHARE_TARGETS: SkillShareTarget[] = [
  {
    agent: "claude",
    label: "Claude Code",
    root: "~/.claude",
    detected: true,
    linked: 0,
    total: 5,
    supported: true,
    enabled: false,
  },
];

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
const mockPickOpenPath = vi.mocked(pickOpenPath);
let records: SkillEntry[];
let catalog: SkillCatalog;
let shareTargets: SkillShareTarget[];

function renderTab() {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <SkillsTab />
    </QueryClientProvider>,
  );
}

describe("SkillsTab", () => {
  beforeEach(() => {
    mocks.projectId = null;
    records = [RESEARCH_SKILL, METHODS_COACH, INVALID];
    catalog = { ...EMPTY_CATALOG };
    shareTargets = SHARE_TARGETS.map((target) => ({ ...target }));
    mockPickOpenPath.mockReset();
    mockListen.mockReset().mockResolvedValue(() => {});
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
      if (command === "skills_set_project_enabled") {
        const input = args as { projectId: string; id: string; enabled: boolean | null };
        const current = records.find((skill) => skill.id === input.id);
        if (!current) throw new Error(`Unknown skill: ${input.id}`);
        const next = {
          ...current,
          projectEnabled: input.enabled === true,
          projectDisabled: input.enabled === false,
        };
        records = records.map((skill) => (skill.id === input.id ? next : skill));
        return next;
      }
      if (command === "skills_update_builtin") {
        const input = args as { id: string };
        const current = records.find((skill) => skill.id === input.id);
        if (!current) throw new Error(`Unknown skill: ${input.id}`);
        const next = { ...current, updateAvailable: false, version: "2026.09.04" };
        records = records.map((skill) => (skill.id === input.id ? next : skill));
        return next;
      }
      if (command === "skills_add") {
        const next = { ...METHODS_COACH, id: "imported", name: "Imported Skill" };
        records = [...records, next];
        return next;
      }
      if (command === "skills_create") {
        const input = (args as { input: { name: string; description: string; instructions?: string } }).input;
        const next: SkillEntry = {
          ...METHODS_COACH,
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
          ...METHODS_COACH,
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
      if (command === "skills_catalog") return catalog;
      if (command === "skills_install") {
        const input = args as { id: string };
        catalog = {
          ...catalog,
          skills: catalog.skills.map((entry) =>
            entry.id === input.id ? { ...entry, installed: true } : entry,
          ),
        };
        return { ...METHODS_COACH, id: input.id, tier: "shelf", source: "catalog" };
      }
      if (command === "skills_uninstall") {
        const input = args as { id: string };
        catalog = {
          ...catalog,
          skills: catalog.skills.map((entry) =>
            entry.id === input.id ? { ...entry, installed: false } : entry,
          ),
        };
        return undefined;
      }
      if (command === "skills_share_targets") return shareTargets;
      if (command === "skills_share_sync") {
        const input = args as { enabled: boolean };
        shareTargets = shareTargets.map((target) => ({
          ...target,
          enabled: input.enabled,
          linked: input.enabled ? target.total : 0,
        }));
        return shareTargets;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("groups skills by phase and shows tier and source badges", async () => {
    renderTab();

    expect(await screen.findByText("Paper Lookup")).toBeInTheDocument();
    expect(screen.getByTestId("skills-phase-research")).toBeInTheDocument();
    expect(within(screen.getByTestId("skills-phase-research")).getByText("Paper Lookup")).toBeInTheDocument();
    expect(screen.getByTestId("skills-phase-user")).toBeInTheDocument();
    expect(within(screen.getByTestId("skills-phase-user")).getByText("Methods Coach")).toBeInTheDocument();
    expect(screen.getByText(copy.source.bundled)).toBeInTheDocument();
    expect(screen.getAllByText(copy.source.added)).toHaveLength(2);
    expect(
      screen.getByText(
        new RegExp(
          escapeRegExp(fill(copy.tier.credits, { credits: "Scientific Agent Skills, MIT" })),
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: enableName("Paper Lookup") })).toBeChecked();
    expect(screen.getByRole("switch", { name: enableName("Methods Coach") })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: enableName("broken") })).toBeDisabled();
    expect(
      screen.getByText('SKILL.md is missing the front matter field "description".'),
    ).toBeInTheDocument();
  });

  it("groups an installed domain shelf skill separately from its phase", async () => {
    records = [...records, SHELF_SKILL];
    renderTab();

    await screen.findByText("Genomics Toolkit");
    expect(screen.getByTestId("skills-phase-shelf")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("skills-phase-shelf")).getByText("Genomics Toolkit"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("skills-phase-research")).queryByText("Genomics Toolkit"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(escapeRegExp(fill(copy.tier.shelfWithLicense, { license: "MIT" }))),
      ),
    ).toBeInTheDocument();
  });

  it("shows a collapsible file list when a skill has supporting files", async () => {
    renderTab();
    await screen.findByText("Paper Lookup");

    expect(screen.queryByText("SKILL.md")).not.toBeInTheDocument();
    expect(screen.getByTestId("skill-files-toggle-paper-lookup")).toHaveTextContent(
      fill(copy.fileCount_other, { count: "2" }),
    );
    fireEvent.click(screen.getByTestId("skill-files-toggle-paper-lookup"));
    expect(await screen.findByText("SKILL.md")).toBeInTheDocument();
    expect(screen.getByText("references/checklist.md")).toBeInTheDocument();
  });

  it("persists a device-wide skill toggle", async () => {
    renderTab();
    await screen.findByText("Methods Coach");

    fireEvent.click(screen.getByRole("switch", { name: enableName("Methods Coach") }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_set_enabled", {
        id: "methods-coach",
        enabled: true,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: enableName("Methods Coach") })).toBeChecked(),
    );
  });

  it("shows one device-wide toggle per skill and no scope switch without a project", async () => {
    renderTab();
    await screen.findByText("Paper Lookup");

    expect(screen.queryByTestId("skills-scope")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("skill-row-paper-lookup")).getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: enableName("Paper Lookup") })).toBeChecked();
  });

  it("changes the device setting from All projects while a project is open", async () => {
    mocks.projectId = "proj-1";
    renderTab();
    await screen.findByText("Methods Coach");

    expect(screen.getByTestId("skills-scope-device")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("switch", { name: enableName("Methods Coach") }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_set_enabled", {
        id: "methods-coach",
        enabled: true,
      }),
    );
    expect(mockInvoke).not.toHaveBeenCalledWith("skills_set_project_enabled", expect.anything());
  });

  it("switches the toggles to this project and marks a project change", async () => {
    mocks.projectId = "proj-1";
    renderTab();
    await screen.findByText("Methods Coach");

    fireEvent.click(screen.getByTestId("skills-scope-project"));
    expect(screen.getByTestId("skills-scope-project")).toHaveAttribute("aria-pressed", "true");
    const toggle = screen.getByRole("switch", { name: projectName("Methods Coach") });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByTestId("skill-project-changed-methods-coach")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_set_project_enabled", {
        projectId: "proj-1",
        id: "methods-coach",
        enabled: true,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: projectName("Methods Coach") })).toBeChecked(),
    );
    expect(
      within(screen.getByTestId("skill-project-changed-methods-coach")).getByText(
        copy.changedForProject,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("skills-scope-device"));
    expect(screen.getByRole("switch", { name: enableName("Methods Coach") })).not.toBeChecked();
    expect(screen.queryByTestId("skill-project-changed-methods-coach")).not.toBeInTheDocument();
  });

  it("resets a project change back to the All projects setting", async () => {
    mocks.projectId = "proj-1";
    records = [{ ...RESEARCH_SKILL, projectDisabled: true }, METHODS_COACH];
    renderTab();
    await screen.findByText("Paper Lookup");
    fireEvent.click(screen.getByTestId("skills-scope-project"));

    expect(screen.getByRole("switch", { name: projectName("Paper Lookup") })).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: fill(copy.resetProjectAria, { name: "Paper Lookup" }) }),
    );

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_set_project_enabled", {
        projectId: "proj-1",
        id: "paper-lookup",
        enabled: null,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: projectName("Paper Lookup") })).toBeChecked(),
    );
    expect(screen.queryByTestId("skill-project-changed-paper-lookup")).not.toBeInTheDocument();
  });

  it("clears the project override when a project toggle goes back to the device setting", async () => {
    mocks.projectId = "proj-1";
    renderTab();
    await screen.findByText("Paper Lookup");
    fireEvent.click(screen.getByTestId("skills-scope-project"));

    fireEvent.click(screen.getByRole("switch", { name: projectName("Paper Lookup") }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_set_project_enabled", {
        projectId: "proj-1",
        id: "paper-lookup",
        enabled: false,
      }),
    );
    await screen.findByTestId("skill-project-changed-paper-lookup");

    fireEvent.click(screen.getByRole("switch", { name: projectName("Paper Lookup") }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_set_project_enabled", {
        projectId: "proj-1",
        id: "paper-lookup",
        enabled: null,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("skill-project-changed-paper-lookup")).not.toBeInTheDocument(),
    );
  });

  it("re-reads the project scope after a device toggle", async () => {
    mocks.projectId = "proj-1";
    renderTab();
    await screen.findByText("Methods Coach");
    const listCalls = () =>
      mockInvoke.mock.calls.filter(([command]) => command === "skills_list").length;
    const before = listCalls();

    fireEvent.click(screen.getByRole("switch", { name: enableName("Methods Coach") }));

    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });

  it("searches installed skills by name, phase and source", async () => {
    renderTab();
    await screen.findByText("Paper Lookup");
    const search = screen.getByRole("searchbox", { name: copy.search.ariaLabel });

    fireEvent.change(search, { target: { value: "methods" } });
    expect(screen.getByText("Methods Coach")).toBeInTheDocument();
    expect(screen.queryByText("Paper Lookup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("skills-phase-research")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: copy.phases.research } });
    expect(screen.getByText("Paper Lookup")).toBeInTheDocument();
    expect(screen.queryByText("Methods Coach")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: copy.source.bundled } });
    expect(screen.getByText("Paper Lookup")).toBeInTheDocument();
    expect(screen.queryByText("broken")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByText("Methods Coach")).toBeInTheDocument();
    expect(screen.getByText("Paper Lookup")).toBeInTheDocument();
  });

  it("searches the domain shelf too and shows one no-match message", async () => {
    catalog = { ...EMPTY_CATALOG, skills: [SHELF_ENTRY] };
    renderTab();
    await screen.findByTestId("skill-shelf-row-genomics-toolkit");
    const search = screen.getByRole("searchbox", { name: copy.search.ariaLabel });

    fireEvent.change(search, { target: { value: "genomics" } });
    expect(screen.getByTestId("skill-shelf-row-genomics-toolkit")).toBeInTheDocument();
    expect(screen.queryByText("Paper Lookup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("skills-no-match")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "paper" } });
    expect(screen.getByText("Paper Lookup")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-shelf-row-genomics-toolkit")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("skills-no-match")).toHaveLength(1);

    fireEvent.change(search, { target: { value: "nothing like this" } });
    await waitFor(() => expect(screen.getAllByTestId("skills-no-match")).toHaveLength(1));
    expect(screen.getByText(copy.search.empty)).toBeInTheDocument();
    expect(screen.queryByText("Paper Lookup")).not.toBeInTheDocument();
  });

  it("updates a bundled skill after confirmation", async () => {
    records = [...records, STALE_BUILTIN];
    renderTab();
    await screen.findByText("Research Loop");

    fireEvent.click(screen.getByTestId("skill-update-oleafly-research-loop"));
    const confirmation = screen.getByRole("alertdialog", { name: copy.updateDialog.title });
    fireEvent.click(within(confirmation).getByRole("button", { name: copy.updateAction }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_update_builtin", {
        id: "oleafly-research-loop",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("skill-update-oleafly-research-loop")).not.toBeInTheDocument(),
    );
  });

  it("adds a selected skill folder", async () => {
    mockPickOpenPath.mockResolvedValue("/tmp/imported-skill");
    renderTab();
    await screen.findByText("Paper Lookup");

    fireEvent.click(screen.getByRole("button", { name: copy.addFolder }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_add", {
        sourcePath: "/tmp/imported-skill",
      }),
    );
    expect(await screen.findByText("Imported Skill")).toBeInTheDocument();
  });

  it("creates a disabled skill from the editor", async () => {
    renderTab();
    await screen.findByText("Paper Lookup");
    fireEvent.click(screen.getByRole("button", { name: copy.createSkill }));

    fireEvent.change(screen.getByLabelText(enCommon.labels.name), {
      target: { value: "Claim Checker" },
    });
    fireEvent.change(screen.getByLabelText(enCommon.labels.description), {
      target: { value: "Check whether each claim has support." },
    });
    fireEvent.change(screen.getByLabelText(copy.editor.instructions), {
      target: { value: "Read every claim and find its supporting citation." },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.editor.submitCreate }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_create", {
        input: {
          name: "Claim Checker",
          description: "Check whether each claim has support.",
          instructions: "Read every claim and find its supporting citation.",
        },
      }),
    );
    expect(await screen.findByRole("switch", { name: enableName("Claim Checker") })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      fill(copy.messages.created, { name: "Claim Checker" }),
    );
  });

  it("validates an invalid user skill and edits it in place", async () => {
    renderTab();
    await screen.findByText("broken");

    fireEvent.click(
      screen.getByRole("button", { name: fill(copy.validateAria, { name: "broken" }) }),
    );
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_validate", { id: "broken" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: enableName("broken") })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: fill(copy.editAria, { name: "broken" }) }));
    fireEvent.change(screen.getByLabelText(enCommon.labels.name), {
      target: { value: "Draft Reviewer" },
    });
    fireEvent.change(screen.getByLabelText(enCommon.labels.description), {
      target: { value: "Review a saved draft." },
    });
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.save }));

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

  it("does not offer Validate or Edit for a bundled skill", async () => {
    renderTab();
    await screen.findByText("Paper Lookup");
    expect(
      screen.queryByRole("button", { name: fill(copy.validateAria, { name: "Paper Lookup" }) }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: fill(copy.editAria, { name: "Paper Lookup" }) }),
    ).not.toBeInTheDocument();
  });

  it("removes a user skill after confirmation", async () => {
    renderTab();
    await screen.findByText("Methods Coach");

    fireEvent.click(
      screen.getByRole("button", { name: fill(copy.removeAria, { name: "Methods Coach" }) }),
    );
    const confirmation = screen.getByRole("alertdialog", { name: copy.removeDialog.title });
    fireEvent.click(within(confirmation).getByRole("button", { name: enCommon.actions.remove }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_remove", { id: "methods-coach" }),
    );
    await waitFor(() => expect(screen.queryByText("Methods Coach")).not.toBeInTheDocument());
  });

  it("installs a domain shelf skill from the catalog", async () => {
    catalog = { ...EMPTY_CATALOG, source: "cached", fetchedAt: "2026-09-01T00:00:00Z", skills: [SHELF_ENTRY] };
    renderTab();

    await screen.findByText("Genomics Toolkit");
    fireEvent.click(screen.getByTestId("skill-shelf-install-genomics-toolkit"));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_install", { id: "genomics-toolkit" }),
    );
    await screen.findByTestId("skill-shelf-uninstall-genomics-toolkit");
  });

  it("refreshes the catalog and shows the network fallback line", async () => {
    catalog = { ...EMPTY_CATALOG, error: "offline" };
    renderTab();

    await screen.findByText(copy.catalog.source.bundledOffline);
    fireEvent.click(screen.getByTestId("skills-catalog-refresh"));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_catalog", { refresh: true }),
    );
  });

  it("names the cached catalog when an offline refresh kept the cached list", async () => {
    catalog = {
      ...EMPTY_CATALOG,
      source: "cached",
      fetchedAt: "2026-09-01T00:00:00Z",
      error: "offline",
      skills: [SHELF_ENTRY],
    };
    renderTab();

    await screen.findByText(
      new RegExp(`^${escapeRegExp(copy.catalog.source.cached.replace("{{when}}", ""))}`),
    );
    expect(
      screen.queryByText(new RegExp(escapeRegExp(copy.catalog.source.bundled))),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("Genomics Toolkit")).toBeInTheDocument();
  });

  it("turns on skill sharing with other agents", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId("skills-share-toggle")).toBeEnabled());
    expect(screen.queryByTestId("skills-share-target-claude")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("skills-share-card-toggle"));
    await screen.findByTestId("skills-share-target-claude");

    fireEvent.click(screen.getByTestId("skills-share-toggle"));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_share_sync", { enabled: true }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(fill(copy.share.status.linked, { linked: "5", total: "5" })),
      ).toBeInTheDocument(),
    );
  });

  it("asks for the missing fields before creating or saving", async () => {
    renderTab();
    await screen.findByText("Methods Coach");

    fireEvent.click(screen.getByRole("button", { name: copy.createSkill }));
    fireEvent.click(screen.getByRole("button", { name: copy.editor.submitCreate }));
    expect(await screen.findByText(copy.editor.requiredBasics)).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(copy.editor.requiredBasics)).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: fill(copy.editAria, { name: "Methods Coach" }) }));
    fireEvent.change(screen.getByLabelText(copy.editor.instructions), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.save }));

    expect(await screen.findByText(copy.editor.requiredAll)).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("skills_create", expect.anything());
    expect(mockInvoke).not.toHaveBeenCalledWith("skills_update", expect.anything());
  });

  it("keeps the editor open with the error when the skill cannot be created", async () => {
    const base = mockInvoke.getMockImplementation();
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "skills_create") throw new Error("Folder already exists");
      return base?.(command, args);
    });
    renderTab();
    await screen.findByText("Paper Lookup");
    fireEvent.click(screen.getByRole("button", { name: copy.createSkill }));
    fireEvent.change(screen.getByLabelText(enCommon.labels.name), { target: { value: "Claim Checker" } });
    fireEvent.change(screen.getByLabelText(enCommon.labels.description), { target: { value: "Check claims." } });

    fireEvent.click(screen.getByRole("button", { name: copy.editor.submitCreate }));

    expect(await screen.findByText("Folder already exists")).toBeInTheDocument();
    expect(screen.getByLabelText(enCommon.labels.name)).toHaveValue("Claim Checker");
  });

  it("reports toggles and removals that fail", async () => {
    const base = mockInvoke.getMockImplementation();
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "skills_set_enabled") throw new Error("Settings are read-only");
      if (command === "skills_remove") throw new Error("Folder is in use");
      return base?.(command, args);
    });
    renderTab();
    await screen.findByText("Methods Coach");

    fireEvent.click(screen.getByRole("switch", { name: enableName("Methods Coach") }));
    expect(await screen.findByText("Settings are read-only")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: fill(copy.removeAria, { name: "Methods Coach" }) }));
    const confirmation = screen.getByRole("alertdialog", { name: copy.removeDialog.title });
    fireEvent.click(within(confirmation).getByRole("button", { name: enCommon.actions.remove }));

    expect(await screen.findByText("Folder is in use")).toBeInTheDocument();
    expect(screen.getByText("Methods Coach")).toBeInTheDocument();
  });

  it("keeps a skill when the removal or update is cancelled and when no folder is picked", async () => {
    records = [...records, STALE_BUILTIN];
    mockPickOpenPath.mockResolvedValue(null);
    renderTab();
    await screen.findByText("Research Loop");

    fireEvent.click(screen.getByRole("button", { name: fill(copy.removeAria, { name: "Methods Coach" }) }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: copy.removeDialog.title })).getByRole("button", {
        name: new RegExp(`^${enCommon.actions.cancel}`),
      }),
    );
    fireEvent.click(screen.getByTestId("skill-update-oleafly-research-loop"));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: copy.updateDialog.title })).getByRole("button", {
        name: new RegExp(`^${enCommon.actions.cancel}`),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: copy.addFolder }));
    await waitFor(() => expect(mockPickOpenPath).toHaveBeenCalled());

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("skills_remove", expect.anything());
    expect(mockInvoke).not.toHaveBeenCalledWith("skills_update_builtin", expect.anything());
    expect(mockInvoke).not.toHaveBeenCalledWith("skills_add", expect.anything());
  });

  it("hides the file list again and names vendored and shelf skills without credits", async () => {
    records = [
      { ...RESEARCH_SKILL, author: null, license: null },
      { ...SHELF_SKILL, license: null },
    ];
    renderTab();
    await screen.findByText("Paper Lookup");

    expect(screen.getByText(new RegExp(escapeRegExp(copy.tier.vendored)))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(escapeRegExp(copy.tier.shelf)))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("skill-files-toggle-paper-lookup"));
    expect(await screen.findByText("SKILL.md")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("skill-files-toggle-paper-lookup"));
    await waitFor(() => expect(screen.queryByText("SKILL.md")).not.toBeInTheDocument());
  });

  it("says when there are no skills and when they cannot be loaded", async () => {
    records = [];
    const { unmount } = render(
      <QueryClientProvider client={createAppQueryClient()}>
        <SkillsTab />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
    unmount();

    const base = mockInvoke.getMockImplementation();
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "skills_list") throw new Error("Skills folder is unreadable");
      return base?.(command, args);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SkillsTab />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      fill(copy.loadFailed, { message: "Skills folder is unreadable" }),
    );
  });
});

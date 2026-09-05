import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLoadSkillTools,
  draftSkillFromChat,
  enabledSkills,
  loadSkills,
  mergeToggledSkillRecord,
  parseSkillCommand,
  readSkillFile,
  requestedSkillPrompt,
  resetSkillPreferences,
  setSkillEnabled,
  setSkillProjectEnabled,
  skillCatalogPrompt,
  skillDirectiveLine,
  skillsQueryKey,
  steeredSkillText,
  updateBuiltinSkill,
  type SkillEntry,
} from "./skills";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function skill(overrides: Partial<SkillEntry> & Pick<SkillEntry, "id">): SkillEntry {
  return {
    name: overrides.id,
    description: `Description for ${overrides.id}.`,
    instructions: `Instructions for ${overrides.id}.`,
    dir: `/skills/${overrides.id}`,
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
    ...overrides,
  };
}

const ENABLED_SKILL = skill({
  id: "proof-review",
  name: "Proof Review",
  description: "Review a proof for logical gaps.",
  instructions: "Read each claim and verify its dependencies.",
  phase: "review",
  enabled: true,
});

const DISABLED_SKILL = skill({
  id: "citation-audit",
  name: "Citation Audit",
  description: "Check every citation in a manuscript.",
  instructions: "Inspect each citation key and bibliography entry.",
  phase: "research",
});

const INVALID_SKILL = skill({
  id: "broken",
  name: "broken",
  description: "",
  instructions: "",
  validation: {
    status: "invalid",
    code: "missing-description",
    message: 'SKILL.md is missing the front matter field "description".',
  },
});

describe("skills client", () => {
  const mockInvoke = vi.mocked(invoke);

  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("returns valid and invalid skills for the open project", async () => {
    mockInvoke.mockResolvedValue([ENABLED_SKILL, INVALID_SKILL]);

    await expect(loadSkills("proj-1")).resolves.toEqual([ENABLED_SKILL, INVALID_SKILL]);
    expect(mockInvoke).toHaveBeenCalledWith("skills_list", { projectId: "proj-1" });
  });

  it("keys the cached list by project so a switch does not reuse another project's scope", () => {
    expect(skillsQueryKey("proj-1")).toEqual(["skills", "proj-1"]);
    expect(skillsQueryKey()).toEqual(["skills", null]);
  });

  it("persists global and per-project enable state through the backend", async () => {
    mockInvoke.mockResolvedValue({ ...DISABLED_SKILL, enabled: true });
    await expect(setSkillEnabled("citation-audit", true)).resolves.toMatchObject({
      enabled: true,
    });
    expect(mockInvoke).toHaveBeenCalledWith("skills_set_enabled", {
      id: "citation-audit",
      enabled: true,
    });

    mockInvoke.mockResolvedValue({ ...DISABLED_SKILL, projectEnabled: true });
    await expect(
      setSkillProjectEnabled("proj-1", "citation-audit", true),
    ).resolves.toMatchObject({ projectEnabled: true });
    expect(mockInvoke).toHaveBeenCalledWith("skills_set_project_enabled", {
      projectId: "proj-1",
      id: "citation-audit",
      enabled: true,
    });
  });

  it("clears device and project enablement for the open project on reset", async () => {
    const deviceOn = { ...ENABLED_SKILL, id: "device-on", enabled: true, projectEnabled: false };
    const projectOn = {
      ...DISABLED_SKILL,
      id: "project-on",
      enabled: false,
      projectEnabled: true,
    };
    const untouched = { ...DISABLED_SKILL, id: "untouched" };
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "skills_list") return [deviceOn, projectOn, untouched];
      return {};
    });

    const records = await resetSkillPreferences("proj-1");

    expect(mockInvoke).toHaveBeenCalledWith("skills_list", { projectId: "proj-1" });
    expect(mockInvoke).toHaveBeenCalledWith("skills_set_enabled", {
      id: "device-on",
      enabled: false,
    });
    expect(mockInvoke).toHaveBeenCalledWith("skills_set_project_enabled", {
      projectId: "proj-1",
      id: "project-on",
      enabled: false,
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("skills_set_enabled", {
      id: "untouched",
      enabled: false,
    });
    expect(
      records.map((record) => ({
        id: record.id,
        enabled: record.enabled,
        projectEnabled: record.projectEnabled,
      })),
    ).toEqual([
      { id: "device-on", enabled: false, projectEnabled: false },
      { id: "project-on", enabled: false, projectEnabled: false },
      { id: "untouched", enabled: false, projectEnabled: false },
    ]);
  });

  it("keeps the project scope out of a device toggle written back to the cache", () => {
    const cached = { ...DISABLED_SKILL, enabled: true, projectEnabled: true };
    const projectBlind = { ...DISABLED_SKILL, enabled: false, projectEnabled: false };

    expect(mergeToggledSkillRecord([cached], projectBlind, "device")).toEqual([
      { ...cached, enabled: false },
    ]);
    expect(
      mergeToggledSkillRecord([cached], { ...projectBlind, enabled: false }, "project"),
    ).toEqual([{ ...cached, projectEnabled: false }]);
    expect(mergeToggledSkillRecord(undefined, projectBlind, "device")).toEqual([projectBlind]);
  });

  it("reads one supporting file and refreshes a built-in skill through the backend", async () => {
    mockInvoke.mockResolvedValue({ path: "references/arxiv.md", content: "# arXiv", truncated: false });
    await expect(readSkillFile("paper-lookup", "references/arxiv.md")).resolves.toEqual({
      path: "references/arxiv.md",
      content: "# arXiv",
      truncated: false,
    });
    expect(mockInvoke).toHaveBeenCalledWith("skills_read_file", {
      id: "paper-lookup",
      path: "references/arxiv.md",
    });

    mockInvoke.mockResolvedValue(ENABLED_SKILL);
    await expect(updateBuiltinSkill("paper-lookup")).resolves.toEqual(ENABLED_SKILL);
    expect(mockInvoke).toHaveBeenCalledWith("skills_update_builtin", { id: "paper-lookup" });
  });
});

describe("progressive skill disclosure", () => {
  it("selects valid skills enabled for the device or for the project", () => {
    const projectSkill = skill({ id: "project-only", projectEnabled: true });

    expect(
      enabledSkills([ENABLED_SKILL, DISABLED_SKILL, INVALID_SKILL, projectSkill]),
    ).toEqual([ENABLED_SKILL, projectSkill]);
  });

  it("keeps every enabled skill, with no cap on how many can be on", () => {
    const many = Array.from({ length: 64 }, (_, index) =>
      skill({ id: `skill-${index + 1}`, enabled: true }),
    );

    expect(enabledSkills(many)).toHaveLength(64);
    const schema = createLoadSkillTools(many).load_skill.inputSchema as {
      properties?: { id?: { enum?: string[] } };
    };
    expect(schema.properties?.id?.enum).toHaveLength(64);
    expect(skillCatalogPrompt(many)).toContain("skill-64");
  });

  it("groups the catalog by phase and states the workflow rules", () => {
    const prompt = skillCatalogPrompt([
      skill({
        id: "oleafly-research-loop",
        name: "Research loop",
        description: "Entry point for research writing.",
        phase: "research",
        enabled: true,
      }),
      skill({
        id: "scientific-writing",
        name: "Scientific writing",
        description: "Draft a section.",
        phase: "authoring",
        enabled: true,
      }),
      skill({ id: "loose-skill", description: "No phase set.", enabled: true }),
    ]);

    expect(prompt).toContain("Research workflow map");
    expect(prompt.indexOf("## research")).toBeLessThan(prompt.indexOf("## authoring"));
    expect(prompt.indexOf("## authoring")).toBeLessThan(prompt.indexOf("## other"));
    expect(prompt).toContain('"phase":"research"');
    expect(prompt).toContain(
      'call load_skill with "oleafly-research-loop" first and follow the handoffs it names',
    );
    expect(prompt).toContain("Never say you are using a skill before you have loaded it");
    expect(prompt).toContain("read_skill_file");
  });

  it("caps a long description at 400 characters", () => {
    const prompt = skillCatalogPrompt([
      skill({ id: "wordy", description: "x".repeat(600), enabled: true }),
    ]);

    expect(prompt).toContain("x".repeat(400));
    expect(prompt).not.toContain("x".repeat(401));
  });

  it("injects enabled metadata without full instructions", () => {
    const prompt = skillCatalogPrompt([ENABLED_SKILL, DISABLED_SKILL, INVALID_SKILL]);

    expect(prompt).toContain("Proof Review");
    expect(prompt).toContain("Review a proof for logical gaps.");
    expect(prompt).not.toContain("Read each claim and verify its dependencies.");
    expect(prompt).not.toContain("Citation Audit");
    expect(prompt).not.toContain("broken");
    expect(prompt).toContain("load_skill");
  });

  it("returns nothing to inject when no skill is enabled", () => {
    expect(skillCatalogPrompt([DISABLED_SKILL, INVALID_SKILL])).toBe("");
    expect(createLoadSkillTools([DISABLED_SKILL, INVALID_SKILL])).toEqual({});
  });

  it("loads instructions, the folder path, the file list, and the usage footer", async () => {
    const vendored = skill({
      id: "paper-lookup",
      name: "Paper Lookup",
      description: "Search literature APIs.",
      instructions: "Pick the authoritative database first.",
      dir: "/home/me/.oleafly/skills/paper-lookup",
      files: [
        { path: "SKILL.md", bytes: 7_000 },
        { path: "scripts/arxiv_atom.py", bytes: 2_048 },
      ],
      license: "MIT",
      version: "2.1",
      phase: "research",
      tier: "vendored",
      enabled: true,
    });
    const tools = createLoadSkillTools([vendored]);

    const payload = await tools.load_skill.execute?.({ id: "paper-lookup" });

    expect(payload).toContain('dir="/home/me/.oleafly/skills/paper-lookup"');
    expect(payload).toContain('license="MIT"');
    expect(payload).toContain('version="2.1"');
    expect(payload).toContain('phase="research"');
    expect(payload).toContain("SKILL.md (7 KB)");
    expect(payload).toContain("scripts/arxiv_atom.py (2 KB)");
    expect(payload).toContain("Pick the authoritative database first.");
    expect(payload).toContain("read_skill_file");
    expect(payload).toContain('python3 "/home/me/.oleafly/skills/paper-lookup/scripts/example.py"');
    expect(payload).toContain("Python 3.11 or newer");
  });

  it("refuses a skill that is neither enabled nor requested", async () => {
    const tools = createLoadSkillTools([ENABLED_SKILL, DISABLED_SKILL, INVALID_SKILL]);

    await expect(tools.load_skill.execute?.({ id: "citation-audit" })).resolves.toEqual({
      error: 'Skill "citation-audit" is not enabled for this run.',
    });
    await expect(tools.load_skill.execute?.({ id: "broken" })).resolves.toEqual({
      error: 'Skill "broken" is not enabled for this run.',
    });
    await expect(tools.load_skill.execute?.({ id: "unknown" })).resolves.toEqual({
      error: 'Skill "unknown" is not enabled for this run.',
    });
  });

  it("adds a requested disabled skill to the load_skill enum for this run", async () => {
    const tools = createLoadSkillTools(
      [ENABLED_SKILL, DISABLED_SKILL, INVALID_SKILL],
      ["citation-audit", "broken"],
    );
    const schema = tools.load_skill.inputSchema as {
      properties?: { id?: { enum?: string[] } };
    };

    expect(schema.properties?.id?.enum).toEqual(["proof-review", "citation-audit"]);
    await expect(tools.load_skill.execute?.({ id: "citation-audit" })).resolves.toContain(
      "Inspect each citation key and bibliography entry.",
    );
  });

  it("reads a supporting file through the backend and reports failures as data", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockReset();
    const tools = createLoadSkillTools([ENABLED_SKILL]);

    mockInvoke.mockResolvedValue({ path: "references/a.md", content: "body", truncated: false });
    await expect(
      tools.read_skill_file.execute?.({ id: "proof-review", path: "references/a.md" }),
    ).resolves.toEqual({ path: "references/a.md", content: "body", truncated: false });
    expect(mockInvoke).toHaveBeenCalledWith("skills_read_file", {
      id: "proof-review",
      path: "references/a.md",
    });

    mockInvoke.mockRejectedValue("path escapes the skill folder");
    await expect(
      tools.read_skill_file.execute?.({ id: "proof-review", path: "../secrets" }),
    ).resolves.toEqual({ error: "path escapes the skill folder" });

    await expect(
      tools.read_skill_file.execute?.({ id: "citation-audit", path: "a.md" }),
    ).resolves.toEqual({ error: 'Skill "citation-audit" is not enabled for this run.' });
    await expect(
      tools.read_skill_file.execute?.({ id: "proof-review", path: "  " }),
    ).resolves.toEqual({ error: "Pass the path of a file listed by load_skill." });
  });
});

describe("skill invocation from the composer", () => {
  const skills = [ENABLED_SKILL, DISABLED_SKILL, skill({ id: "proof" })];

  it("strips a leading skill token and keeps the rest of the request", () => {
    expect(parseSkillCommand("/citation-audit check section 3", skills)).toEqual({
      skill: DISABLED_SKILL,
      text: "check section 3",
    });
    expect(parseSkillCommand("/citation-audit", skills)?.text).toBe("");
  });

  it("prefers the longest matching id", () => {
    expect(parseSkillCommand("/proof-review look here", skills)?.skill.id).toBe("proof-review");
    expect(parseSkillCommand("/proof look here", skills)?.skill.id).toBe("proof");
  });

  it("ignores anything that is not a skill token", () => {
    expect(parseSkillCommand("/model", skills)).toBeNull();
    expect(parseSkillCommand("/proof-reviewer help", skills)).toBeNull();
    expect(parseSkillCommand("please use /proof-review", skills)).toBeNull();
    expect(parseSkillCommand("/broken now", [INVALID_SKILL])).toBeNull();
  });

  it("renders the requested skill block with the full instructions", () => {
    const prompt = requestedSkillPrompt([DISABLED_SKILL]);

    expect(prompt).toContain('<requested_skill id="citation-audit" name="Citation Audit">');
    expect(prompt).toContain("Inspect each citation key and bibliography entry.");
    expect(prompt).toContain("</requested_skill>");
    expect(requestedSkillPrompt([])).toBe("");
  });

  it("rewrites a steered skill token as the directive plus the rest of the request", () => {
    expect(steeredSkillText("/proof-review find the 2024 survey", skills)).toBe(
      `${skillDirectiveLine(ENABLED_SKILL)}\nfind the 2024 survey`,
    );
    expect(steeredSkillText("no token here", skills)).toBe("no token here");
  });

  it("carries the instructions of a skill the running turn cannot load", () => {
    const steered = steeredSkillText("/citation-audit check section 3", skills);

    expect(steered).toContain(skillDirectiveLine(DISABLED_SKILL));
    expect(steered).toContain('<requested_skill id="citation-audit"');
    expect(steered).toContain("Inspect each citation key and bibliography entry.");
    expect(steered).toContain("check section 3");
  });
});

describe("recorded skill drafts", () => {
  it("distills a completed chat and todo plan into a bounded valid draft", () => {
    const draft = draftSkillFromChat({
      messages: [
        { role: "user", content: "Review this proof and find logical gaps." },
        {
          role: "assistant",
          content: "I mapped the claims, checked each dependency, and summarized the gaps.",
          reasoning: "private chain of thought",
          toolCalls: [{ name: "read_file", status: "done", output: "secret output" }],
        },
      ],
      todos: [
        { content: "Map every claim to its dependencies", status: "completed" },
        { content: "Check each dependency", status: "completed" },
        { content: "Discarded experiment", status: "cancelled" },
      ],
    });

    expect(draft).not.toBeNull();
    expect(draft?.name).toMatch(/Review This Proof/u);
    expect(draft?.description).toContain("Review this proof and find logical gaps");
    expect(draft?.instructions).toContain("1. Map every claim to its dependencies");
    expect(draft?.instructions).toContain("2. Check each dependency");
    expect(draft?.instructions).not.toContain("Discarded experiment");
    expect(draft?.instructions).not.toContain("private chain of thought");
    expect(draft?.instructions).not.toContain("secret output");
    expect(draft?.instructions.length).toBeLessThanOrEqual(8_000);
  });

  it("returns no draft for a chat without a completed exchange", () => {
    expect(
      draftSkillFromChat({
        messages: [{ role: "user", content: "Review this proof." }],
        todos: [],
      }),
    ).toBeNull();
  });

  it("does not turn final-answer findings into reusable procedure steps", () => {
    const draft = draftSkillFromChat({
      messages: [
        { role: "user", content: "Check whether this theorem is true." },
        {
          role: "assistant",
          content:
            "The theorem is false. The case x = 2 is a counterexample, so the stated conclusion does not hold.",
        },
      ],
      todos: [],
    });

    expect(draft).not.toBeNull();
    expect(draft?.instructions).not.toContain("The theorem is false");
    expect(draft?.instructions).not.toContain("x = 2");
    expect(draft?.instructions).toContain("Replace this scaffold");
  });

  it("keeps explicit approach steps from a completed answer", () => {
    const draft = draftSkillFromChat({
      messages: [
        { role: "user", content: "Audit this proof." },
        {
          role: "assistant",
          content:
            "## Approach\n\n1. Map each claim to its dependencies.\n2. Test every dependency against the assumptions.\n\n**Findings**\n\n- The third claim has a gap.",
        },
      ],
      todos: [],
    });

    expect(draft?.instructions).toContain("1. Map each claim to its dependencies.");
    expect(draft?.instructions).toContain(
      "2. Test every dependency against the assumptions.",
    );
    expect(draft?.instructions).not.toContain("The third claim has a gap");
  });

  it("keeps multibyte recorded drafts within backend validation limits", () => {
    const draft = draftSkillFromChat({
      messages: [
        { role: "user", content: `${"研".repeat(200)} workflow` },
        { role: "assistant", content: "Completed the workflow." },
      ],
      todos: Array.from({ length: 8 }, (_, index) => ({
        content: `${index + 1} ${"研".repeat(700)}`,
        status: "completed",
      })),
    });

    expect(draft).not.toBeNull();
    if (!draft) return;
    expect(Array.from(draft.name)).toHaveLength(100);
    expect(Array.from(draft.description).length).toBeLessThanOrEqual(500);
    const rendered = `---\nname: ${draft.name}\ndescription: ${draft.description}\n---\n\n${draft.instructions}\n`;
    expect(new TextEncoder().encode(rendered).length).toBeLessThan(10_000);
  });
});

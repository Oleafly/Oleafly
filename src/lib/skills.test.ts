import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLoadSkillTools,
  draftSkillFromChat,
  enabledSkills,
  loadSkills,
  setSkillEnabled,
  skillCatalogPrompt,
  type SkillEntry,
} from "./skills";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const ENABLED_SKILL: SkillEntry = {
  id: "proof-review",
  name: "Proof Review",
  description: "Review a proof for logical gaps.",
  instructions: "Read each claim and verify its dependencies.",
  source: "user",
  enabled: true,
  removable: true,
  validation: { status: "valid" },
};

const DISABLED_SKILL: SkillEntry = {
  ...ENABLED_SKILL,
  id: "citation-audit",
  name: "Citation Audit",
  description: "Check every citation in a manuscript.",
  instructions: "Inspect each citation key and bibliography entry.",
  enabled: false,
};

const INVALID_SKILL: SkillEntry = {
  id: "broken",
  name: "broken",
  description: "",
  instructions: "",
  source: "user",
  enabled: false,
  removable: true,
  validation: {
    status: "invalid",
    code: "missing-description",
    message: 'SKILL.md is missing the front matter field "description".',
  },
};

describe("skills client", () => {
  const mockInvoke = vi.mocked(invoke);

  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("returns valid and invalid skills from the typed backend list", async () => {
    mockInvoke.mockResolvedValue([ENABLED_SKILL, INVALID_SKILL]);

    await expect(loadSkills()).resolves.toEqual([ENABLED_SKILL, INVALID_SKILL]);
    expect(mockInvoke).toHaveBeenCalledWith("skills_list");
  });

  it("persists global enable state through the backend", async () => {
    mockInvoke.mockResolvedValue({ ...DISABLED_SKILL, enabled: true });

    await expect(setSkillEnabled("citation-audit", true)).resolves.toMatchObject({
      id: "citation-audit",
      enabled: true,
    });
    expect(mockInvoke).toHaveBeenCalledWith("skills_set_enabled", {
      id: "citation-audit",
      enabled: true,
    });
  });
});

describe("progressive skill disclosure", () => {
  it("selects only enabled valid skills", () => {
    expect(enabledSkills([ENABLED_SKILL, DISABLED_SKILL, INVALID_SKILL])).toEqual([
      ENABLED_SKILL,
    ]);
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

  it("loads the full instructions only for an enabled skill", async () => {
    const tools = createLoadSkillTools([ENABLED_SKILL, DISABLED_SKILL, INVALID_SKILL]);

    await expect(tools.load_skill.execute?.({ id: "proof-review" })).resolves.toContain(
      "Read each claim and verify its dependencies.",
    );
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

  it("uses the same bounded enabled set for discovery and loading", () => {
    const skills = Array.from({ length: 33 }, (_, index): SkillEntry => ({
      ...ENABLED_SKILL,
      id: `skill-${index + 1}`,
      name: `Skill ${index + 1}`,
      description: `Description ${index + 1}`,
    }));

    const prompt = skillCatalogPrompt(skills);
    const tools = createLoadSkillTools(skills);
    const schema = tools.load_skill.inputSchema as {
      properties?: { id?: { enum?: string[] } };
    };
    const ids = schema.properties?.id?.enum;

    expect(enabledSkills(skills)).toHaveLength(32);
    expect(ids).toHaveLength(32);
    expect(prompt).toContain("Skill 32");
    expect(prompt).not.toContain("Skill 33");
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

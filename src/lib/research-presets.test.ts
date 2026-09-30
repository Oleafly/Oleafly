import { beforeAll, describe, expect, it } from "vitest";
import { initTestI18n } from "@/components/ai/acp/tests/ui-fixtures";
import { cliResearchPresets, presetPrompt, RESEARCH_PRESET_PROMPTS, researchPresets } from "./research-presets";

beforeAll(async () => {
  await initTestI18n();
});

describe("research presets", () => {
  it("offers the CLI research presets in a fixed order", () => {
    expect(researchPresets().map((preset) => preset.id)).toEqual([
      "literature-sweep",
      "related-work",
      "citation-audit",
      "manuscript-review",
      "reproducibility-audit",
      "figure-audit",
      "git-review",
      "reference-cleanup",
    ]);
    expect(researchPresets().map((preset) => preset.label)).toEqual([
      "Literature sweep",
      "Related work",
      "Citation audit",
      "Manuscript review",
      "Reproducibility audit",
      "Figure audit",
      "Git review",
      "Reference cleanup",
    ]);
  });

  it("keeps prompts plain so CLI agents never see slash commands", () => {
    for (const preset of researchPresets()) {
      expect(preset.prompt.startsWith("/")).toBe(false);
    }
    expect(researchPresets().find((preset) => preset.id === "citation-audit")?.skillId).toBe("oleafly-verify-claims");
  });

  it("ends every audit with the no-edit instruction and its own findings file", () => {
    const audits: Record<string, string> = {
      "citation-audit": "claims",
      "manuscript-review": "manuscript-review",
      "reproducibility-audit": "reproducibility-audit",
      "figure-audit": "figure-audit",
      "git-review": "git-review",
    };
    for (const [id, file] of Object.entries(audits)) {
      const preset = researchPresets().find((value) => value.id === id);
      expect(preset?.prompt.endsWith(`Do not change manuscript files; write findings to research/${file}.md.`)).toBe(true);
    }
  });

  it("hides Git review outside Git repositories and keeps reference cleanup as an action", () => {
    expect(cliResearchPresets({ gitRepository: false }).map((preset) => preset.id)).not.toContain("git-review");
    expect(cliResearchPresets({ gitRepository: true }).map((preset) => preset.id)).toContain("git-review");
    const cleanup = cliResearchPresets({ gitRepository: true }).find((preset) => preset.id === "reference-cleanup");
    expect(cleanup?.action).toBe("clean-library");
  });

  it("lets the built-in assistant add the slash skill itself", () => {
    expect(presetPrompt(RESEARCH_PRESET_PROMPTS.literatureSweep, "oleafly-literature-sweep")).toBe(
      "/oleafly-literature-sweep Build an annotated reading list for this project's research question",
    );
    expect(presetPrompt("Recompile and check for errors")).toBe("Recompile and check for errors");
  });
});

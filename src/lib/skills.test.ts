import { describe, expect, it } from "vitest";
import { parseSkillPacks } from "./skills";

const VALID_MANIFEST = JSON.stringify({
  name: "pdf-to-latex",
  version: "1.0.0",
  description: "Reconstruct a PDF as LaTeX.",
});

const VALID_SKILL_MD =
  "---\nname: pdf-to-latex\ndescription: Reconstruct a PDF as LaTeX.\n---\n\nRead the attached PDF and rebuild it.\n";

describe("parseSkillPacks", () => {
  it("validates the manifest and extracts the instruction body", () => {
    const packs = parseSkillPacks([
      { id: "pdf-to-latex", manifest_json: VALID_MANIFEST, skill_md: VALID_SKILL_MD },
    ]);

    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      id: "pdf-to-latex",
      name: "pdf-to-latex",
      version: "1.0.0",
      description: "Reconstruct a PDF as LaTeX.",
    });
    expect(packs[0].instructions).toBe("Read the attached PDF and rebuild it.");
  });

  it("drops packs with an invalid manifest instead of failing the list", () => {
    const packs = parseSkillPacks([
      { id: "broken", manifest_json: '{"version": 3}', skill_md: VALID_SKILL_MD },
      { id: "ok", manifest_json: VALID_MANIFEST, skill_md: VALID_SKILL_MD },
    ]);

    expect(packs.map((p) => p.id)).toEqual(["ok"]);
  });

  it("falls back to SKILL.md frontmatter when there is no manifest", () => {
    const packs = parseSkillPacks([
      { id: "frontmatter-only", manifest_json: "", skill_md: VALID_SKILL_MD },
    ]);

    expect(packs).toHaveLength(1);
    expect(packs[0].name).toBe("pdf-to-latex");
    expect(packs[0].description).toBe("Reconstruct a PDF as LaTeX.");
  });

  it("drops packs with no usable instructions", () => {
    const packs = parseSkillPacks([
      { id: "empty", manifest_json: VALID_MANIFEST, skill_md: "" },
    ]);

    expect(packs).toEqual([]);
  });
});

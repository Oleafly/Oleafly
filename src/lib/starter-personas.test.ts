import { describe, expect, it } from "vitest";
import type { AppConfig } from "@oleafly/backend-port";
import { PERSONA_COLORS } from "@/lib/persona-colors";
import {
  STARTER_PERSONAS,
  isStarterPersonaInstalled,
  starterPersonasForInstall,
} from "@/lib/starter-personas";

describe("starter personas", () => {
  it("includes a valid figure authoring persona", () => {
    const figure = STARTER_PERSONAS.find((persona) => persona.id === "starter-figure");
    const validColors = new Set(PERSONA_COLORS.map((color) => color.key));

    expect(STARTER_PERSONAS).toHaveLength(4);
    expect(new Set(STARTER_PERSONAS.map((persona) => persona.id)).size).toBe(4);
    expect(figure).toMatchObject({
      name: "Draw a Figure",
      color: "sunset",
    });
    expect(validColors.has(figure?.color as (typeof PERSONA_COLORS)[number]["key"])).toBe(true);
    expect(figure?.prompt).toMatch(/publication-quality/u);
    expect(figure?.prompt).toMatch(/TikZ/u);
    expect(figure?.prompt).toMatch(/PGFPlots/u);
    expect(figure?.prompt).toMatch(/revise/u);
    expect(figure?.prompt).toMatch(/Never invent data/u);
    expect(
      STARTER_PERSONAS.some((persona) =>
        `${persona.name}${persona.description}${persona.prompt}`.includes("—"),
      ),
    ).toBe(false);
  });

  it("creates a persistence payload without suggestion-only descriptions", () => {
    const personas = starterPersonasForInstall();

    expect(personas.map((persona) => persona.id)).toEqual([
      "starter-research-writer",
      "starter-document-editor",
      "starter-critical-reviewer",
      "starter-figure",
    ]);
    expect(personas.every((persona) => !("description" in persona))).toBe(true);
  });

  it("recognizes an installed starter by id or normalized name", () => {
    const personas: AppConfig["ai_personas"] = [
      {
        id: "custom",
        name: "RESEARCH WRITER",
        color: "slate",
        prompt: "Keep my customized instructions.",
      },
      {
        id: "starter-document-editor",
        name: "My Editor",
        color: "grape",
        prompt: "Keep this edited starter.",
      },
    ];

    expect(isStarterPersonaInstalled(personas, STARTER_PERSONAS[0])).toBe(true);
    expect(isStarterPersonaInstalled(personas, STARTER_PERSONAS[1])).toBe(true);
    expect(isStarterPersonaInstalled(personas, STARTER_PERSONAS[2])).toBe(false);
  });
});

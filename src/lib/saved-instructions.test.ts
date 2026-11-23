import { describe, expect, it } from "vitest";
import type { AppConfig, SavedInstruction } from "@/lib/tauri";
import {
  canSaveMore,
  hasSavedText,
  newSavedInstruction,
  pickedInstructions,
  rankSavedInstructions,
  SAVED_INSTRUCTION_LIMITS,
  suggestInstructionName,
  usesOf,
} from "./saved-instructions";

const keep: SavedInstruction = { id: "keep", name: "Keep formatting", text: "Keep the formatting." };
const quotes: SavedInstruction = { id: "quotes", name: "Quotes", text: "Don't change quoted text." };
const grammar: SavedInstruction = { id: "grammar", name: "Grammar only", text: "Only fix grammar." };

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ai_saved_instructions: [keep, quotes, grammar], ...overrides } as AppConfig;
}

describe("saved instructions", () => {
  it("puts the most used first and keeps the saved order between equals", () => {
    expect(rankSavedInstructions(config()).map((entry) => entry.id)).toEqual(["keep", "quotes", "grammar"]);
    expect(
      rankSavedInstructions(config({ ai_saved_instruction_uses: { grammar: 4, quotes: 4, keep: 1 } })).map(
        (entry) => entry.id,
      ),
    ).toEqual(["quotes", "grammar", "keep"]);
    expect(rankSavedInstructions(null)).toEqual([]);
    expect(usesOf(config({ ai_saved_instruction_uses: { keep: 2 } }), "keep")).toBe(2);
    expect(usesOf(config(), "keep")).toBe(0);
  });

  it("returns the picked instructions that still exist and have text, in saved order", () => {
    const blank = { id: "blank", name: "Blank", text: "  " };
    const cfg = config({ ai_saved_instructions: [keep, quotes, blank] });
    expect(pickedInstructions(cfg, ["quotes", "gone", "keep", "blank"])).toEqual([keep, quotes]);
    expect(pickedInstructions(null, ["keep"])).toEqual([]);
  });

  it("suggests a short name from the first words of the text", () => {
    expect(suggestInstructionName("  Keep the original formatting and don't change quoted text ")).toBe(
      "Keep the original formatting and",
    );
    expect(suggestInstructionName("Short")).toBe("Short");
    expect(suggestInstructionName("x".repeat(90))).toHaveLength(SAVED_INSTRUCTION_LIMITS.name);
    expect(suggestInstructionName("line one\nline two")).toBe("line one line two");
  });

  it("knows when the text is already saved and when the list is full", () => {
    expect(hasSavedText(config(), "  Only fix grammar. ")).toBe(true);
    expect(hasSavedText(config(), "Only fix spelling.")).toBe(false);
    expect(canSaveMore(config())).toBe(true);
    const full = Array.from({ length: SAVED_INSTRUCTION_LIMITS.count }, (_, index) => ({
      id: `n${index}`,
      name: `n${index}`,
      text: "t",
    }));
    expect(canSaveMore(config({ ai_saved_instructions: full }))).toBe(false);
  });

  it("trims and caps a new instruction", () => {
    const made = newSavedInstruction(`  ${"n".repeat(80)} `, ` ${"t".repeat(2_100)} `);
    expect(made.id).toMatch(/[0-9a-f-]{36}/u);
    expect(made.name).toHaveLength(SAVED_INSTRUCTION_LIMITS.name);
    expect(made.text).toHaveLength(SAVED_INSTRUCTION_LIMITS.text);
  });
});

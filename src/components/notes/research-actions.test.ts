import { describe, expect, it } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { RESEARCH_ACTIONS } from "./research-actions";

describe("research actions", () => {
  it("lists each action once with an icon and a label in the English catalog", () => {
    const ids = RESEARCH_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(enNotes.prompt.actions).sort((a, b) => a.localeCompare(b)),
    );
    for (const action of RESEARCH_ACTIONS) expect(action.icon).toBeTruthy();
  });
});

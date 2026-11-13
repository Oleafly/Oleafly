import { describe, expect, it } from "vitest";
import { NAME_TONES, nameTone, TONES } from "./tones";

describe("tones", () => {
  it("writes every tone in one colour family that reads in light and dark", () => {
    for (const [family, tone] of Object.entries(TONES)) {
      expect(tone.icon).toBe(`text-${family}-600 dark:text-${family}-400`);
      expect(tone.text).toBe(`text-${family}-700 dark:text-${family}-300`);
      expect(tone.tint).toBe(`bg-${family}-500/10`);
      expect(tone.hover).toBe(`hover:bg-${family}-500/20 focus-visible:bg-${family}-500/20`);
      expect(tone.dot).toBe(`bg-${family}-500`);
    }
  });

  it("gives a name the same tone on every call", () => {
    for (const name of ["daily", "lab/2024", "", "日本語"]) {
      expect(nameTone(name)).toBe(nameTone(name));
      expect(NAME_TONES).toContain(nameTone(name));
    }
  });

  it("keeps grey out of the name tones so no name looks switched off", () => {
    expect(NAME_TONES).not.toContain(TONES.slate);
    expect(new Set(NAME_TONES).size).toBe(NAME_TONES.length);
  });

  it("spreads names over the whole palette", () => {
    const names = Array.from({ length: 600 }, (_, index) => `tag-${index}`);
    const counts = new Map<unknown, number>();
    for (const name of names) counts.set(nameTone(name), (counts.get(nameTone(name)) ?? 0) + 1);
    expect(counts.size).toBe(NAME_TONES.length);
    const fair = names.length / NAME_TONES.length;
    for (const count of counts.values()) expect(count).toBeLessThan(fair * 2);
  });
});

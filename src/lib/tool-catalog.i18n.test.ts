// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  convertAdHoc: vi.fn(),
  extractArxivSource: vi.fn(),
  getConfig: vi.fn(),
}));

import { AD_HOC_CONVERTERS, converterCopy } from "@/features/ad-hoc-converters";
import { i18n } from "@/i18n";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import zhResearchTools from "@/i18n/locales/zh-Hans/researchTools.json" with { type: "json" };
import type { ConverterToolId } from "@/lib/converter-types";
import {
  TOOL_DEFINITIONS,
  toolDescription,
  toolName,
  toolTags,
  type ToolId,
} from "@/lib/tool-catalog";

const CONVERTER_IDS = Object.keys(AD_HOC_CONVERTERS) as ConverterToolId[];
const TOOL_IDS: readonly ToolId[] = [
  ...TOOL_DEFINITIONS.map((tool) => tool.id),
  "equation",
  "table",
];

function flatten(value: unknown, prefix = "", out: string[] = []): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (typeof value === "string") out.push(prefix);
  return out;
}

const englishConverterTitles = new Map<ConverterToolId, string>();
const englishToolNames = new Map<ToolId, string>();

beforeAll(async () => {
  for (const id of CONVERTER_IDS) englishConverterTitles.set(id, converterCopy(id).title);
  for (const id of TOOL_IDS) englishToolNames.set(id, toolName(id));
  i18n.addResourceBundle("zh-Hans", "researchTools", zhResearchTools, true, true);
  await i18n.changeLanguage("zh-Hans");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("researchTools catalog parity", () => {
  it("keeps the zh-Hans key set identical to English apart from _one plurals", () => {
    const english = flatten(enResearchTools)
      .filter((key) => !key.endsWith("_one"))
      .sort();
    const chinese = flatten(zhResearchTools).sort();
    expect(chinese).toEqual(english);
  });

  it("translates every ad hoc converter workspace under zh-Hans", () => {
    expect(i18n.language).toBe("zh-Hans");
    for (const id of CONVERTER_IDS) {
      const copy = converterCopy(id);
      for (const [field, value] of Object.entries(copy)) {
        expect(value.trim(), `${id} ${field}`).not.toBe("");
        expect(value, `${id} ${field}`).not.toContain("researchTools.");
      }
      expect(copy.title, `${id} title`).not.toBe(englishConverterTitles.get(id));
    }
  });

  it("translates every catalog card and tool-page alias under zh-Hans", () => {
    expect(i18n.language).toBe("zh-Hans");
    for (const id of TOOL_IDS) {
      const name = toolName(id);
      const description = toolDescription(id);
      const tags = toolTags(id);
      expect(name.trim(), `${id} name`).not.toBe("");
      expect(description.trim(), `${id} description`).not.toBe("");
      expect(name, `${id} name`).not.toContain("researchTools.");
      expect(description, `${id} description`).not.toContain("researchTools.");
      expect(name, `${id} name`).not.toBe(englishToolNames.get(id));
      expect(tags.length, `${id} tags`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag.trim(), `${id} tag`).not.toBe("");
        expect(tag, `${id} tag`).not.toContain("researchTools.");
      }
    }
  });
});

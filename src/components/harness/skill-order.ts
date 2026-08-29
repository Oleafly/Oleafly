import type { SkillPack } from "@/lib/skills";

// Research-loop workflows lead; utility skills follow. Shared by the sidebar's
// workflow section and the harness empty state so both present one order.
const RESEARCH_ORDER = [
  "research-authoring",
  "research-review",
  "research-citation",
  "research-publish",
  "conduct-research",
];

export function orderedSkills(skills: SkillPack[]): SkillPack[] {
  return [...skills].sort((a, b) => {
    const ai = RESEARCH_ORDER.indexOf(a.id);
    const bi = RESEARCH_ORDER.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.id.localeCompare(b.id);
  });
}

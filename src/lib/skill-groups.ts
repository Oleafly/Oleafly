import { i18n } from "@/i18n";
import type { SkillEntry } from "@/lib/skills";

export const SKILL_PHASE_ORDER = [
  "research",
  "authoring",
  "figures",
  "review",
  "submission",
  "communication",
  "tooling",
] as const;

export type SkillPhase = (typeof SKILL_PHASE_ORDER)[number];

export const SKILL_PHASE_LABELS: Record<string, string> = {
  research: "Research",
  authoring: "Authoring",
  figures: "Figures",
  review: "Review",
  submission: "Submission",
  communication: "Communication",
  tooling: "Tooling",
};

export interface SkillGroup {
  key: string;
  label: string;
  skills: SkillEntry[];
}

export function groupSkills(skills: readonly SkillEntry[]): SkillGroup[] {
  const byPhase = new Map<string, SkillEntry[]>();
  const yours: SkillEntry[] = [];
  const shelf: SkillEntry[] = [];
  for (const skill of skills) {
    if (skill.tier === "shelf") {
      shelf.push(skill);
      continue;
    }
    if (skill.phase && SKILL_PHASE_LABELS[skill.phase]) {
      const list = byPhase.get(skill.phase) ?? [];
      list.push(skill);
      byPhase.set(skill.phase, list);
      continue;
    }
    yours.push(skill);
  }
  const byName = (list: SkillEntry[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
  const groups: SkillGroup[] = [];
  for (const phase of SKILL_PHASE_ORDER) {
    const list = byPhase.get(phase);
    if (list && list.length > 0) {
      groups.push({ key: phase, label: SKILL_PHASE_LABELS[phase], skills: byName(list) });
    }
  }
  if (yours.length > 0) groups.push({
      key: "user",
      label: i18n.t(($) => $.core.skillGroups.user),
      skills: byName(yours),
    });
  if (shelf.length > 0) groups.push({
      key: "shelf",
      label: i18n.t(($) => $.core.skillGroups.shelf),
      skills: byName(shelf),
    });
  return groups;
}

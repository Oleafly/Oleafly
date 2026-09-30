import {
  BookOpen,
  ClipboardCheck,
  FlaskConical,
  GitCompare,
  Glasses,
  Image as ImageIcon,
  Library,
  Search,
  type LucideIcon,
} from "lucide-react";
import { i18n } from "@/i18n";

/**
 * A research quick start. `prompt` is plain text: CLI agents treat a leading
 * `/` as their own command syntax, so a skill travels separately as
 * `skillId`. The built-in assistant adds `/${skillId}` itself
 * (see {@link presetPrompt}).
 */
export interface ResearchPreset {
  id: string;
  label: string;
  icon: LucideIcon;
  prompt: string;
  skillId?: string;
  /** Opens an Oleafly tool instead of filling the composer. */
  action?: "clean-library";
  /** Only offered when the project is a Git repository. */
  gitOnly?: boolean;
}

const readOnly = (file: string) => ` Do not change manuscript files; write findings to research/${file}.md.`;

/** Agent-facing prompt text (not UI copy), shared by both runtimes. */
export const RESEARCH_PRESET_PROMPTS = {
  literatureSweep: "Build an annotated reading list for this project's research question",
  relatedWork: "Draft the related work section from the reading list and the bibliography",
  citationAudit: `Audit the claims in this manuscript against their cited sources.${readOnly("claims")}`,
  manuscriptReview: `Review the full manuscript and write the report.${readOnly("manuscript-review")}`,
  reproducibilityAudit:
    "Check whether each result in this project can be reproduced: code, data, software versions, random seeds and build instructions. List what is missing for each result." +
    readOnly("reproducibility-audit"),
  figureAudit:
    "Check every figure and table: captions, labels, cross-references, axis labels and units, readability, and colours that stay clear in greyscale." +
    readOnly("figure-audit"),
  gitReview:
    "Review this Git repository: summarise the uncommitted changes and the recent commits (git status, git diff and git log), and flag edits that look unintended or risky." +
    readOnly("git-review"),
} as const;

export function researchPresets(): ResearchPreset[] {
  return [
    {
      id: "literature-sweep",
      label: i18n.t(($) => $.ai.presets.literatureSweep),
      icon: Search,
      prompt: RESEARCH_PRESET_PROMPTS.literatureSweep,
      skillId: "oleafly-literature-sweep",
    },
    {
      id: "related-work",
      label: i18n.t(($) => $.ai.presets.relatedWork),
      icon: BookOpen,
      prompt: RESEARCH_PRESET_PROMPTS.relatedWork,
      skillId: "oleafly-related-work",
    },
    {
      id: "citation-audit",
      label: i18n.t(($) => $.ai.presets.citationAudit),
      icon: ClipboardCheck,
      prompt: RESEARCH_PRESET_PROMPTS.citationAudit,
      skillId: "oleafly-verify-claims",
    },
    {
      id: "manuscript-review",
      label: i18n.t(($) => $.ai.presets.manuscriptReview),
      icon: Glasses,
      prompt: RESEARCH_PRESET_PROMPTS.manuscriptReview,
      skillId: "oleafly-review-manuscript",
    },
    {
      id: "reproducibility-audit",
      label: i18n.t(($) => $.ai.presets.reproducibilityAudit),
      icon: FlaskConical,
      prompt: RESEARCH_PRESET_PROMPTS.reproducibilityAudit,
    },
    {
      id: "figure-audit",
      label: i18n.t(($) => $.ai.presets.figureAudit),
      icon: ImageIcon,
      prompt: RESEARCH_PRESET_PROMPTS.figureAudit,
    },
    {
      id: "git-review",
      label: i18n.t(($) => $.ai.presets.gitReview),
      icon: GitCompare,
      prompt: RESEARCH_PRESET_PROMPTS.gitReview,
      gitOnly: true,
    },
    {
      id: "reference-cleanup",
      label: i18n.t(($) => $.ai.presets.referenceCleanup),
      icon: Library,
      prompt: "",
      action: "clean-library",
    },
  ];
}

/** The presets the CLI agent home offers for this project. */
export function cliResearchPresets({ gitRepository }: Readonly<{ gitRepository: boolean }>): ResearchPreset[] {
  return researchPresets().filter((preset) => gitRepository || !preset.gitOnly);
}

/** Built-in assistant form: the skill rides in the text as a slash command. */
export function presetPrompt(prompt: string, skillId?: string): string {
  return skillId ? `/${skillId} ${prompt}` : prompt;
}

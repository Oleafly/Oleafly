import {
  BookOpen,
  ClipboardCheck,
  FlaskConical,
  GitCompare,
  Glasses,
  Image as ImageIcon,
  Library,
  MessageSquareReply,
  Search,
  Send,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { i18n } from "@/i18n";

export interface ResearchPreset {
  id: string;
  label: string;
  icon: LucideIcon;
  prompt: string;
  skillId?: string;
  action?: "clean-library";
  gitOnly?: boolean;
}

const readOnly = (file: string) => ` Do not change manuscript files; write findings to research/${file}.md.`;

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
  compilationRepair: "Compile this project and fix every error until it builds cleanly",
  submissionPrep: "Run the pre-submission checks for the target venue",
  reviewerResponse:
    "Turn the reviewer comments and the changes already made into a point-by-point response letter",
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
      id: "compilation-repair",
      label: i18n.t(($) => $.ai.presets.compilationRepair),
      icon: Wrench,
      prompt: RESEARCH_PRESET_PROMPTS.compilationRepair,
      skillId: "oleafly-latex-build",
    },
    {
      id: "submission-prep",
      label: i18n.t(($) => $.ai.presets.submissionPrep),
      icon: Send,
      prompt: RESEARCH_PRESET_PROMPTS.submissionPrep,
      skillId: "oleafly-pre-submission",
    },
    {
      id: "reviewer-response",
      label: i18n.t(($) => $.ai.presets.reviewerResponse),
      icon: MessageSquareReply,
      prompt: RESEARCH_PRESET_PROMPTS.reviewerResponse,
      skillId: "oleafly-response-letter",
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

export function cliResearchPresets({ gitRepository }: Readonly<{ gitRepository: boolean }>): ResearchPreset[] {
  return researchPresets().filter((preset) => gitRepository || !preset.gitOnly);
}

export function presetPrompt(prompt: string, skillId?: string): string {
  return skillId ? `/${skillId} ${prompt}` : prompt;
}

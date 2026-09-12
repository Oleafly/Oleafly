import {
  BookOpen,
  Check,
  FileCheck,
  FileText,
  FlaskConical,
  Hash,
  Library,
  Maximize2,
  MessageSquare,
  Minimize2,
  MonitorPlay,
  PenLine,
  PenTool,
  Presentation,
  Quote,
  RefreshCw,
  Search,
  Sigma,
  Sparkles,
  Table,
  Type,
  Wand2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { i18n } from "@/i18n";

export interface PromptShortcut {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  prompt: string;
}

export interface PromptCategory {
  id: string;
  label: string;
  items: PromptShortcut[];
}

// Every prompt here is something the assistant's existing tools (file edit,
// compile, the research/citation connectors, figure drawing) can actually
// attempt - no card promises a capability the app doesn't have.
export function promptCategories(): PromptCategory[] {
  return [
    {
      id: "write-and-edit",
      label: i18n.t(($) => $.ai.shortcuts.categories.writeAndEdit),
      items: [
        {
          id: "improve-writing",
          icon: Sparkles,
          label: i18n.t(($) => $.ai.shortcuts.improveWriting.label),
          description: i18n.t(($) => $.ai.shortcuts.improveWriting.description),
          prompt: "Improve the writing in the current section: polish clarity, tone, and flow without changing the meaning.",
        },
        {
          id: "fix-grammar",
          icon: Check,
          label: i18n.t(($) => $.ai.shortcuts.fixGrammar.label),
          description: i18n.t(($) => $.ai.shortcuts.fixGrammar.description),
          prompt: "Fix grammar and punctuation issues in the current document.",
        },
        {
          id: "fix-latex-errors",
          icon: Wrench,
          label: i18n.t(($) => $.ai.shortcuts.fixLatexErrors.label),
          description: i18n.t(($) => $.ai.shortcuts.fixLatexErrors.description),
          prompt: "Find and fix any LaTeX errors or compile issues in this document.",
        },
        {
          id: "write-equation",
          icon: Sigma,
          label: i18n.t(($) => $.ai.shortcuts.writeEquation.label),
          description: i18n.t(($) => $.ai.shortcuts.writeEquation.description),
          prompt: "Write a LaTeX equation for: ",
        },
        {
          id: "draft-section",
          icon: PenLine,
          label: i18n.t(($) => $.ai.shortcuts.draftSection.label),
          description: i18n.t(($) => $.ai.shortcuts.draftSection.description),
          prompt: "Draft a new section called '' in the style of the rest of this document.",
        },
        {
          id: "paraphrase",
          icon: RefreshCw,
          label: i18n.t(($) => $.ai.shortcuts.paraphrase.label),
          description: i18n.t(($) => $.ai.shortcuts.paraphrase.description),
          prompt: "Paraphrase the selected text, keeping the same meaning.",
        },
        {
          id: "shorten",
          icon: Minimize2,
          label: i18n.t(($) => $.ai.shortcuts.shorten.label),
          description: i18n.t(($) => $.ai.shortcuts.shorten.description),
          prompt: "Make the current section more concise without losing key information.",
        },
        {
          id: "expand",
          icon: Maximize2,
          label: i18n.t(($) => $.ai.shortcuts.expand.label),
          description: i18n.t(($) => $.ai.shortcuts.expand.description),
          prompt: "Expand the current section with more detail and explanation.",
        },
        {
          id: "journal-format",
          icon: FileCheck,
          label: i18n.t(($) => $.ai.shortcuts.journalFormat.label),
          description: i18n.t(($) => $.ai.shortcuts.journalFormat.description),
          prompt: "Reformat this paper for submission to: ",
        },
        {
          id: "write-abstract",
          icon: FileText,
          label: i18n.t(($) => $.ai.shortcuts.writeAbstract.label),
          description: i18n.t(($) => $.ai.shortcuts.writeAbstract.description),
          prompt: "Write an abstract for this paper based on its content.",
        },
        {
          id: "generate-title",
          icon: Type,
          label: i18n.t(($) => $.ai.shortcuts.generateTitle.label),
          description: i18n.t(($) => $.ai.shortcuts.generateTitle.description),
          prompt: "Suggest a few compelling titles for this paper.",
        },
        {
          id: "keywords",
          icon: Hash,
          label: i18n.t(($) => $.ai.shortcuts.keywords.label),
          description: i18n.t(($) => $.ai.shortcuts.keywords.description),
          prompt: "Extract searchable keywords from this paper.",
        },
        {
          id: "continue-writing",
          icon: Wand2,
          label: i18n.t(($) => $.ai.shortcuts.continueWriting.label),
          description: i18n.t(($) => $.ai.shortcuts.continueWriting.description),
          prompt: "Continue writing from where I left off, matching the existing style.",
        },
      ],
    },
    {
      id: "citations-and-literature",
      label: i18n.t(($) => $.ai.shortcuts.categories.citationsAndLiterature),
      items: [
        {
          id: "citation-search",
          icon: Search,
          label: i18n.t(($) => $.ai.shortcuts.citationSearch.label),
          description: i18n.t(($) => $.ai.shortcuts.citationSearch.description),
          prompt: "Search for papers relevant to: ",
        },
        {
          id: "literature-review",
          icon: BookOpen,
          label: i18n.t(($) => $.ai.shortcuts.literatureReview.label),
          description: i18n.t(($) => $.ai.shortcuts.literatureReview.description),
          prompt: "Write a literature review section surveying related work on: ",
        },
        {
          id: "cite-claim",
          icon: Quote,
          label: i18n.t(($) => $.ai.shortcuts.citeClaim.label),
          description: i18n.t(($) => $.ai.shortcuts.citeClaim.description),
          prompt: "Find and add a citation for this claim: ",
        },
        {
          id: "my-library",
          icon: Library,
          label: i18n.t(($) => $.ai.shortcuts.myLibrary.label),
          description: i18n.t(($) => $.ai.shortcuts.myLibrary.description),
          prompt: "Search my imported reference library for: ",
        },
        {
          id: "lab-search",
          icon: FlaskConical,
          label: i18n.t(($) => $.ai.shortcuts.labSearch.label),
          description: i18n.t(($) => $.ai.shortcuts.labSearch.description),
          prompt: "Find research labs and institutions working on: ",
        },
      ],
    },
    {
      id: "review",
      label: i18n.t(($) => $.ai.shortcuts.categories.review),
      items: [
        {
          id: "friendly-review",
          icon: MessageSquare,
          label: i18n.t(($) => $.ai.shortcuts.friendlyReview.label),
          description: i18n.t(($) => $.ai.shortcuts.friendlyReview.description),
          prompt:
            "Review the current document in Friendly mode: supportive, specific, structured (Summary, Strengths, Suggestions, Minor issues, Overall). Use the full paper content available to you.",
        },
        {
          id: "fire-review",
          icon: MessageSquare,
          label: i18n.t(($) => $.ai.shortcuts.fireReview.label),
          description: i18n.t(($) => $.ai.shortcuts.fireReview.description),
          prompt:
            "Review the current document in Fire mode (Reviewer #2): rigorous, technically precise, structured (Summary, Major issues, Minor issues, Questions, Verdict). Every criticism must be substantive.",
        },
      ],
    },
    {
      id: "figures-and-tables",
      label: i18n.t(($) => $.ai.shortcuts.categories.figuresAndTables),
      items: [
        {
          id: "academic-presentation",
          icon: MonitorPlay,
          label: i18n.t(($) => $.ai.shortcuts.academicPresentation.label),
          description: i18n.t(($) => $.ai.shortcuts.academicPresentation.description),
          prompt: "Turn this paper into a Beamer slide presentation.",
        },
        {
          id: "academic-poster",
          icon: Presentation,
          label: i18n.t(($) => $.ai.shortcuts.academicPoster.label),
          description: i18n.t(($) => $.ai.shortcuts.academicPoster.description),
          prompt: "Turn this paper into a conference poster.",
        },
        {
          id: "generate-table",
          icon: Table,
          label: i18n.t(($) => $.ai.shortcuts.generateTable.label),
          description: i18n.t(($) => $.ai.shortcuts.generateTable.description),
          prompt: "Draft a LaTeX table for: ",
        },
        {
          id: "tikz-figure",
          icon: PenTool,
          label: i18n.t(($) => $.ai.shortcuts.tikzFigure.label),
          description: i18n.t(($) => $.ai.shortcuts.tikzFigure.description),
          prompt: "Draft a TikZ figure for: ",
        },
      ],
    },
  ];
}

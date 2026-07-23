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

export interface PromptShortcut {
  icon: LucideIcon;
  label: string;
  description: string;
  prompt: string;
}

export interface PromptCategory {
  label: string;
  items: PromptShortcut[];
}

// Every prompt here is something the assistant's existing tools (file edit,
// compile, the research/citation connectors, figure drawing) can actually
// attempt - no card promises a capability the app doesn't have.
export const PROMPT_CATEGORIES: PromptCategory[] = [
  {
    label: "Write & edit",
    items: [
      {
        icon: Sparkles,
        label: "Improve writing",
        description: "Polish clarity, tone and flow",
        prompt: "Improve the writing in the current section: polish clarity, tone, and flow without changing the meaning.",
      },
      {
        icon: Check,
        label: "Fix grammar",
        description: "Correct grammar and punctuation",
        prompt: "Fix grammar and punctuation issues in the current document.",
      },
      {
        icon: Wrench,
        label: "Fix LaTeX errors",
        description: "Repair broken code and compile errors",
        prompt: "Find and fix any LaTeX errors or compile issues in this document.",
      },
      {
        icon: Sigma,
        label: "Write equation",
        description: "Natural language to LaTeX math",
        prompt: "Write a LaTeX equation for: ",
      },
      {
        icon: PenLine,
        label: "Draft a section",
        description: "Write a new section in your style",
        prompt: "Draft a new section called '' in the style of the rest of this document.",
      },
      {
        icon: RefreshCw,
        label: "Paraphrase",
        description: "Reword while keeping meaning",
        prompt: "Paraphrase the selected text, keeping the same meaning.",
      },
      {
        icon: Minimize2,
        label: "Shorten",
        description: "Make text more concise",
        prompt: "Make the current section more concise without losing key information.",
      },
      {
        icon: Maximize2,
        label: "Expand",
        description: "Elaborate with detail",
        prompt: "Expand the current section with more detail and explanation.",
      },
      {
        icon: FileCheck,
        label: "Journal format",
        description: "Reformat for a target venue",
        prompt: "Reformat this paper for submission to: ",
      },
      {
        icon: FileText,
        label: "Write abstract",
        description: "Draft an abstract from the paper",
        prompt: "Write an abstract for this paper based on its content.",
      },
      {
        icon: Type,
        label: "Generate title",
        description: "Compelling paper titles",
        prompt: "Suggest a few compelling titles for this paper.",
      },
      {
        icon: Hash,
        label: "Keywords",
        description: "Extract searchable keywords",
        prompt: "Extract searchable keywords from this paper.",
      },
      {
        icon: Wand2,
        label: "Continue writing",
        description: "Pick up where you left off",
        prompt: "Continue writing from where I left off, matching the existing style.",
      },
    ],
  },
  {
    label: "Citations & literature",
    items: [
      {
        icon: Search,
        label: "Citation search",
        description: "Search alphaXiv and OpenAlex for papers",
        prompt: "Search for papers relevant to: ",
      },
      {
        icon: BookOpen,
        label: "Literature review",
        description: "Survey related work with real sources",
        prompt: "Write a literature review section surveying related work on: ",
      },
      {
        icon: Quote,
        label: "Cite this claim",
        description: "Find and add a verified reference",
        prompt: "Find and add a citation for this claim: ",
      },
      {
        icon: Library,
        label: "My library",
        description: "Search your imported references",
        prompt: "Search my imported reference library for: ",
      },
      {
        icon: FlaskConical,
        label: "Lab search",
        description: "Find research labs and institutions",
        prompt: "Find research labs and institutions working on: ",
      },
    ],
  },
  {
    label: "Review",
    items: [
      {
        icon: MessageSquare,
        label: "Quick review",
        description: "In-chat reviewer feedback",
        prompt: "Give me quick reviewer-style feedback on this document.",
      },
    ],
  },
  {
    label: "Figures & tables",
    items: [
      {
        icon: MonitorPlay,
        label: "Academic presentation",
        description: "A Beamer slide deck from your paper",
        prompt: "Turn this paper into a Beamer slide presentation.",
      },
      {
        icon: Presentation,
        label: "Academic poster",
        description: "A conference poster from your paper",
        prompt: "Turn this paper into a conference poster.",
      },
      {
        icon: Table,
        label: "Generate table",
        description: "Draft a LaTeX table in chat",
        prompt: "Draft a LaTeX table for: ",
      },
      {
        icon: PenTool,
        label: "TikZ figure",
        description: "Draft TikZ code in chat",
        prompt: "Draft a TikZ figure for: ",
      },
    ],
  },
];

import type { ComponentType } from "react";
import {
  Calculator,
  ClipboardClock,
  FileInput,
  LibraryBig,
  School,
  ShieldCheck,
  Table2,
} from "lucide-react";
import type { HomePage } from "@/store/home-view";

export type ToolId =
  | "pdf-to-latex"
  | "equation"
  | "bibtex"
  | "table"
  | "lab-search"
  | "literature-search"
  | "deadlines";

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tags: readonly string[];
  category: string;
  page: HomePage;
  slash: readonly [string, ...string[]];
  tone:
    | "rose"
    | "violet"
    | "emerald"
    | "cyan"
    | "blue"
    | "sky"
    | "amber";
}

export const TOOL_CATEGORY_ORDER = [
  "Convert",
  "Validate",
  "Tables",
  "Research",
] as const;

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    id: "pdf-to-latex",
    name: "PDF to LaTeX",
    description: "Convert PDFs to LaTeX with math, figures, and structure preserved.",
    icon: FileInput,
    tags: ["Math extraction", "Figure export", "Client-side"],
    category: "Convert",
    page: "pdf-import",
    slash: ["pdf-to-latex", "pdf-import"],
    tone: "rose",
  },
  {
    id: "equation",
    name: "LaTeX Preview",
    description:
      "Preview equations, matrices, aligned math, or chemistry, then copy the LaTeX source.",
    icon: Calculator,
    tags: ["KaTeX", "Inline and display", "Copy source"],
    category: "Convert",
    page: "equation",
    slash: ["latex-preview", "equation"],
    tone: "violet",
  },
  {
    id: "bibtex",
    name: "BibTeX Validator",
    description: "Validate .bib files for syntax errors and missing required fields.",
    icon: ShieldCheck,
    tags: ["12 entry types", "Required fields", "Duplicate keys"],
    category: "Validate",
    page: "bibtex",
    slash: ["bibtex-validator", "bibtex"],
    tone: "emerald",
  },
  {
    id: "table",
    name: "LaTeX Table Generator",
    description: "Build LaTeX tables with a visual row and column editor.",
    icon: Table2,
    tags: ["Visual editor", "booktabs", "Export"],
    category: "Tables",
    page: "table",
    slash: ["latex-table", "table-generator", "table"],
    tone: "cyan",
  },
  {
    id: "literature-search",
    name: "Citation Search",
    description:
      "Search scholarly indexes at the same time. Duplicate records are combined automatically.",
    icon: LibraryBig,
    tags: ["5 available indexes", "Saved citations", "Open source"],
    category: "Research",
    page: "literature-search",
    slash: ["citations-search", "citation-search", "literature-search"],
    tone: "blue",
  },
  {
    id: "lab-search",
    name: "Lab Search",
    description: "Find research institutions worldwide through the OpenAlex directory.",
    icon: School,
    tags: ["Institution records", "Country filter", "ROR links"],
    category: "Research",
    page: "lab-search",
    slash: ["lab-search", "institution-search"],
    tone: "sky",
  },
  {
    id: "deadlines",
    name: "Conference Deadlines",
    description: "View countdowns and filters for computer science conference deadlines.",
    icon: ClipboardClock,
    tags: ["Live countdown", "Field filters", "ccf-deadlines"],
    category: "Research",
    page: "deadlines",
    slash: ["conference-deadlines", "deadlines"],
    tone: "amber",
  },
];

export function toolById(id: ToolId): ToolDefinition {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}

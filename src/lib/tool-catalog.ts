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
import { i18n } from "@/i18n";
import type { HomePage } from "@/store/home-view";

export type ToolId =
  | "pdf-to-latex"
  | "equation"
  | "bibtex"
  | "table"
  | "lab-search"
  | "literature-search"
  | "deadlines";

export type ToolCategory = "convert" | "validate" | "tables" | "research";

export interface ToolDefinition {
  id: ToolId;
  icon: ComponentType<{ className?: string }>;
  category: ToolCategory;
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
  "convert",
  "validate",
  "tables",
  "research",
] as const satisfies readonly ToolCategory[];

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    id: "pdf-to-latex",
    icon: FileInput,
    category: "convert",
    page: "pdf-import",
    slash: ["pdf-to-latex", "pdf-import"],
    tone: "rose",
  },
  {
    id: "equation",
    icon: Calculator,
    category: "convert",
    page: "equation",
    slash: ["latex-preview", "equation"],
    tone: "violet",
  },
  {
    id: "bibtex",
    icon: ShieldCheck,
    category: "validate",
    page: "bibtex",
    slash: ["bibtex-validator", "bibtex"],
    tone: "emerald",
  },
  {
    id: "table",
    icon: Table2,
    category: "tables",
    page: "table",
    slash: ["latex-table", "table-generator", "table"],
    tone: "cyan",
  },
  {
    id: "literature-search",
    icon: LibraryBig,
    category: "research",
    page: "literature-search",
    slash: ["citations-search", "citation-search", "literature-search"],
    tone: "blue",
  },
  {
    id: "lab-search",
    icon: School,
    category: "research",
    page: "lab-search",
    slash: ["lab-search", "institution-search"],
    tone: "sky",
  },
  {
    id: "deadlines",
    icon: ClipboardClock,
    category: "research",
    page: "deadlines",
    slash: ["conference-deadlines", "deadlines"],
    tone: "amber",
  },
];

export function toolName(id: ToolId): string {
  switch (id) {
    case "pdf-to-latex":
      return i18n.t(($) => $.researchTools.tools.pdfToLatex.name);
    case "equation":
      return i18n.t(($) => $.researchTools.tools.equation.name);
    case "bibtex":
      return i18n.t(($) => $.researchTools.tools.bibtex.name);
    case "table":
      return i18n.t(($) => $.researchTools.tools.table.name);
    case "literature-search":
      return i18n.t(($) => $.researchTools.tools.literatureSearch.name);
    case "lab-search":
      return i18n.t(($) => $.researchTools.tools.labSearch.name);
    case "deadlines":
      return i18n.t(($) => $.researchTools.tools.deadlines.name);
  }
}

export function toolDescription(id: ToolId): string {
  switch (id) {
    case "pdf-to-latex":
      return i18n.t(($) => $.researchTools.tools.pdfToLatex.description);
    case "equation":
      return i18n.t(($) => $.researchTools.tools.equation.description);
    case "bibtex":
      return i18n.t(($) => $.researchTools.tools.bibtex.description);
    case "table":
      return i18n.t(($) => $.researchTools.tools.table.description);
    case "literature-search":
      return i18n.t(($) => $.researchTools.tools.literatureSearch.description);
    case "lab-search":
      return i18n.t(($) => $.researchTools.tools.labSearch.description);
    case "deadlines":
      return i18n.t(($) => $.researchTools.tools.deadlines.description);
  }
}

export function toolTags(id: ToolId): string[] {
  switch (id) {
    case "pdf-to-latex":
      return [
        i18n.t(($) => $.researchTools.tools.pdfToLatex.tagMath),
        i18n.t(($) => $.researchTools.tools.pdfToLatex.tagFigures),
        i18n.t(($) => $.researchTools.tools.pdfToLatex.tagClientSide),
      ];
    case "equation":
      return [
        i18n.t(($) => $.researchTools.tools.equation.tagKatex),
        i18n.t(($) => $.researchTools.tools.equation.tagModes),
        i18n.t(($) => $.researchTools.tools.equation.tagCopy),
      ];
    case "bibtex":
      return [
        i18n.t(($) => $.researchTools.tools.bibtex.tagEntryTypes),
        i18n.t(($) => $.researchTools.tools.bibtex.tagRequiredFields),
        i18n.t(($) => $.researchTools.tools.bibtex.tagDuplicateKeys),
      ];
    case "table":
      return [
        i18n.t(($) => $.researchTools.tools.table.tagVisualEditor),
        i18n.t(($) => $.researchTools.tools.table.tagBooktabs),
        i18n.t(($) => $.researchTools.tools.table.tagExport),
      ];
    case "literature-search":
      return [
        i18n.t(($) => $.researchTools.tools.literatureSearch.tagIndexes),
        i18n.t(($) => $.researchTools.tools.literatureSearch.tagFromDocument),
        i18n.t(($) => $.researchTools.tools.literatureSearch.tagReview),
        i18n.t(($) => $.researchTools.tools.literatureSearch.tagSaved),
      ];
    case "lab-search":
      return [
        i18n.t(($) => $.researchTools.tools.labSearch.tagRecords),
        i18n.t(($) => $.researchTools.tools.labSearch.tagCountryFilter),
        i18n.t(($) => $.researchTools.tools.labSearch.tagRor),
      ];
    case "deadlines":
      return [
        i18n.t(($) => $.researchTools.tools.deadlines.tagCountdown),
        i18n.t(($) => $.researchTools.tools.deadlines.tagFieldFilters),
        i18n.t(($) => $.researchTools.tools.deadlines.tagSource),
      ];
  }
}

export function toolCategoryLabel(category: ToolCategory): string {
  switch (category) {
    case "convert":
      return i18n.t(($) => $.researchTools.tools.category.convert);
    case "validate":
      return i18n.t(($) => $.researchTools.tools.category.validate);
    case "tables":
      return i18n.t(($) => $.researchTools.tools.category.tables);
    case "research":
      return i18n.t(($) => $.researchTools.tools.category.research);
  }
}

export function toolById(id: ToolId): ToolDefinition {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}

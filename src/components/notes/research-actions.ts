import {
  BookMarked,
  ChartLine,
  ClipboardCheck,
  FileText,
  FlaskConical,
  Minimize2,
  Pencil,
  Plus,
  Search,
  Table,
  type LucideIcon,
} from "lucide-react";
import type { ResearchActionId } from "./types";

export const RESEARCH_ACTIONS: readonly { id: ResearchActionId; icon: LucideIcon }[] = [
  { id: "latestRun", icon: FlaskConical },
  { id: "claims", icon: ClipboardCheck },
  { id: "citations", icon: BookMarked },
  { id: "proofread", icon: Search },
  { id: "rewrite", icon: Pencil },
  { id: "shorter", icon: Minimize2 },
  { id: "paragraph", icon: Plus },
  { id: "table", icon: Table },
  { id: "figure", icon: ChartLine },
  { id: "abstract", icon: FileText },
];

export function isResearchAction(id: string): id is ResearchActionId {
  return RESEARCH_ACTIONS.some((action) => action.id === id);
}

import {
  Atom,
  BookOpen,
  Brain,
  Braces,
  Bug,
  ChartLine,
  Cpu,
  Database,
  Dna,
  FileText,
  FlaskConical,
  GraduationCap,
  Image,
  Layers,
  Lightbulb,
  Microscope,
  Network,
  NotebookPen,
  Rocket,
  Sigma,
  Target,
  Telescope,
  TestTube,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Resources } from "@/i18n/resources-types";
import { cn } from "@/lib/utils";
import type { ArtifactKind } from "./types";

export type LineIconName = keyof Resources["notes"]["icons"]["names"];

export const LINE_ICON_PREFIX = "lucide:";

export const LINE_ICONS: Readonly<Record<string, { icon: LucideIcon; name: LineIconName }>> = {
  atom: { icon: Atom, name: "atom" },
  "book-open": { icon: BookOpen, name: "bookOpen" },
  brain: { icon: Brain, name: "brain" },
  bug: { icon: Bug, name: "bug" },
  "chart-line": { icon: ChartLine, name: "chartLine" },
  cpu: { icon: Cpu, name: "cpu" },
  database: { icon: Database, name: "database" },
  dna: { icon: Dna, name: "dna" },
  "file-text": { icon: FileText, name: "fileText" },
  "flask-conical": { icon: FlaskConical, name: "flaskConical" },
  "graduation-cap": { icon: GraduationCap, name: "graduationCap" },
  layers: { icon: Layers, name: "layers" },
  lightbulb: { icon: Lightbulb, name: "lightbulb" },
  microscope: { icon: Microscope, name: "microscope" },
  network: { icon: Network, name: "network" },
  "notebook-pen": { icon: NotebookPen, name: "notebookPen" },
  rocket: { icon: Rocket, name: "rocket" },
  sigma: { icon: Sigma, name: "sigma" },
  target: { icon: Target, name: "target" },
  telescope: { icon: Telescope, name: "telescope" },
  "test-tube": { icon: TestTube, name: "testTube" },
};

const ICON = "size-3.5 shrink-0 text-muted-foreground";

function lineIcon(icon: string): LucideIcon | null {
  if (!icon.startsWith(LINE_ICON_PREFIX)) return null;
  const id = icon.slice(LINE_ICON_PREFIX.length);
  return Object.hasOwn(LINE_ICONS, id) ? LINE_ICONS[id].icon : NotebookPen;
}

export function NoteIcon({ icon, size = "sm" }: Readonly<{ icon?: string; size?: "sm" | "lg" }>) {
  const large = size === "lg";
  const Icon = icon ? lineIcon(icon) : NotebookPen;
  if (!Icon) {
    return (
      <span aria-hidden className={cn("shrink-0 leading-none", large ? "text-[2.5rem]" : "text-sm")}>
        {icon}
      </span>
    );
  }
  return <Icon aria-hidden className={cn("shrink-0", large ? "size-10 text-foreground" : ICON)} />;
}

export function artifactIcon(kind: ArtifactKind): ReactNode {
  if (kind === "figure") return <Image aria-hidden className={ICON} />;
  if (kind === "run") return <FlaskConical aria-hidden className={ICON} />;
  if (kind === "html") return <Braces aria-hidden className={ICON} />;
  return <FileText aria-hidden className={ICON} />;
}

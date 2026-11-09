import {
  Activity,
  Atom,
  Award,
  Axis3d,
  Beaker,
  Binary,
  Biohazard,
  Bird,
  Bone,
  Book,
  BookMarked,
  BookOpen,
  Bot,
  Braces,
  Brain,
  BrainCircuit,
  Bug,
  Calculator,
  Calendar,
  ChartArea,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartNetwork,
  ChartPie,
  ChartScatter,
  ChartSpline,
  CircuitBoard,
  ClipboardList,
  CloudRain,
  Code,
  CodeXml,
  Cog,
  Compass,
  Cpu,
  Database,
  Divide,
  Dna,
  Droplets,
  Earth,
  Eye,
  Feather,
  File,
  FileText,
  Fish,
  FlaskConical,
  FlaskRound,
  Flower,
  Funnel,
  GitBranch,
  GitMerge,
  Globe,
  GraduationCap,
  HeartPulse,
  Hexagon,
  Hospital,
  Hourglass,
  Image,
  Infinity as InfinityIcon,
  Landmark,
  Languages,
  Layers,
  Leaf,
  Library,
  Lightbulb,
  ListChecks,
  Magnet,
  Map as MapIcon,
  Microchip,
  Microscope,
  Moon,
  Mountain,
  Network,
  Notebook,
  NotebookPen,
  NotebookTabs,
  NotebookText,
  Omega,
  Orbit,
  PawPrint,
  Pencil,
  PenTool,
  Pi,
  Pill,
  Pipette,
  Presentation,
  Puzzle,
  Quote,
  Rabbit,
  Radar,
  Radiation,
  Radical,
  Rocket,
  Ruler,
  SatelliteDish,
  Scale,
  School,
  ScrollText,
  Server,
  Shapes,
  Sheet,
  Shell,
  Sigma,
  Sparkles,
  Sprout,
  SquareFunction,
  Star,
  Stethoscope,
  Sun,
  Syringe,
  Table,
  Target,
  Telescope,
  Terminal,
  TestTube,
  TestTubes,
  Thermometer,
  Timer,
  Trees,
  TrendingUp,
  Trophy,
  Variable,
  Waves,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BOOK_COLOR_OPTIONS } from "@/components/library/Book";
import { Badge } from "@/components/ui/badge";
import type { Resources } from "@/i18n/resources-types";
import { cn } from "@/lib/utils";
import type { ArtifactKind, Author, NoteColor } from "./types";

export type LineIconName = keyof Resources["notes"]["icons"]["names"];

export const LINE_ICON_PREFIX = "lucide:";

export const LINE_ICONS: Readonly<Record<string, { icon: LucideIcon; name: LineIconName }>> = {
  atom: { icon: Atom, name: "atom" },
  beaker: { icon: Beaker, name: "beaker" },
  "flask-conical": { icon: FlaskConical, name: "flaskConical" },
  "flask-round": { icon: FlaskRound, name: "flaskRound" },
  "test-tube": { icon: TestTube, name: "testTube" },
  "test-tubes": { icon: TestTubes, name: "testTubes" },
  pipette: { icon: Pipette, name: "pipette" },
  microscope: { icon: Microscope, name: "microscope" },
  magnet: { icon: Magnet, name: "magnet" },
  thermometer: { icon: Thermometer, name: "thermometer" },
  scale: { icon: Scale, name: "scale" },
  radiation: { icon: Radiation, name: "radiation" },
  biohazard: { icon: Biohazard, name: "biohazard" },
  dna: { icon: Dna, name: "dna" },
  brain: { icon: Brain, name: "brain" },
  bug: { icon: Bug, name: "bug" },
  leaf: { icon: Leaf, name: "leaf" },
  sprout: { icon: Sprout, name: "sprout" },
  trees: { icon: Trees, name: "trees" },
  flower: { icon: Flower, name: "flower" },
  bird: { icon: Bird, name: "bird" },
  fish: { icon: Fish, name: "fish" },
  rabbit: { icon: Rabbit, name: "rabbit" },
  "paw-print": { icon: PawPrint, name: "pawPrint" },
  shell: { icon: Shell, name: "shell" },
  stethoscope: { icon: Stethoscope, name: "stethoscope" },
  "heart-pulse": { icon: HeartPulse, name: "heartPulse" },
  pill: { icon: Pill, name: "pill" },
  syringe: { icon: Syringe, name: "syringe" },
  hospital: { icon: Hospital, name: "hospital" },
  bone: { icon: Bone, name: "bone" },
  eye: { icon: Eye, name: "eye" },
  telescope: { icon: Telescope, name: "telescope" },
  rocket: { icon: Rocket, name: "rocket" },
  orbit: { icon: Orbit, name: "orbit" },
  "satellite-dish": { icon: SatelliteDish, name: "satelliteDish" },
  sun: { icon: Sun, name: "sun" },
  moon: { icon: Moon, name: "moon" },
  star: { icon: Star, name: "star" },
  sparkles: { icon: Sparkles, name: "sparkles" },
  zap: { icon: Zap, name: "zap" },
  waves: { icon: Waves, name: "waves" },
  radar: { icon: Radar, name: "radar" },
  globe: { icon: Globe, name: "globe" },
  earth: { icon: Earth, name: "earth" },
  mountain: { icon: Mountain, name: "mountain" },
  "cloud-rain": { icon: CloudRain, name: "cloudRain" },
  droplets: { icon: Droplets, name: "droplets" },
  sigma: { icon: Sigma, name: "sigma" },
  pi: { icon: Pi, name: "pi" },
  infinity: { icon: InfinityIcon, name: "infinity" },
  radical: { icon: Radical, name: "radical" },
  "square-function": { icon: SquareFunction, name: "squareFunction" },
  variable: { icon: Variable, name: "variable" },
  calculator: { icon: Calculator, name: "calculator" },
  divide: { icon: Divide, name: "divide" },
  omega: { icon: Omega, name: "omega" },
  "axis-3d": { icon: Axis3d, name: "axis3d" },
  shapes: { icon: Shapes, name: "shapes" },
  hexagon: { icon: Hexagon, name: "hexagon" },
  "chart-line": { icon: ChartLine, name: "chartLine" },
  "chart-column": { icon: ChartColumn, name: "chartColumn" },
  "chart-bar": { icon: ChartBar, name: "chartBar" },
  "chart-pie": { icon: ChartPie, name: "chartPie" },
  "chart-scatter": { icon: ChartScatter, name: "chartScatter" },
  "chart-area": { icon: ChartArea, name: "chartArea" },
  "chart-spline": { icon: ChartSpline, name: "chartSpline" },
  "chart-network": { icon: ChartNetwork, name: "chartNetwork" },
  "trending-up": { icon: TrendingUp, name: "trendingUp" },
  activity: { icon: Activity, name: "activity" },
  table: { icon: Table, name: "table" },
  sheet: { icon: Sheet, name: "sheet" },
  database: { icon: Database, name: "database" },
  funnel: { icon: Funnel, name: "funnel" },
  cpu: { icon: Cpu, name: "cpu" },
  microchip: { icon: Microchip, name: "microchip" },
  "circuit-board": { icon: CircuitBoard, name: "circuitBoard" },
  code: { icon: Code, name: "code" },
  "code-xml": { icon: CodeXml, name: "codeXml" },
  terminal: { icon: Terminal, name: "terminal" },
  braces: { icon: Braces, name: "braces" },
  binary: { icon: Binary, name: "binary" },
  "git-branch": { icon: GitBranch, name: "gitBranch" },
  "git-merge": { icon: GitMerge, name: "gitMerge" },
  bot: { icon: Bot, name: "bot" },
  "brain-circuit": { icon: BrainCircuit, name: "brainCircuit" },
  workflow: { icon: Workflow, name: "workflow" },
  network: { icon: Network, name: "network" },
  server: { icon: Server, name: "server" },
  puzzle: { icon: Puzzle, name: "puzzle" },
  "notebook-pen": { icon: NotebookPen, name: "notebookPen" },
  notebook: { icon: Notebook, name: "notebook" },
  "notebook-text": { icon: NotebookText, name: "notebookText" },
  book: { icon: Book, name: "book" },
  "book-open": { icon: BookOpen, name: "bookOpen" },
  "book-marked": { icon: BookMarked, name: "bookMarked" },
  library: { icon: Library, name: "library" },
  "file-text": { icon: FileText, name: "fileText" },
  "scroll-text": { icon: ScrollText, name: "scrollText" },
  quote: { icon: Quote, name: "quote" },
  "pen-tool": { icon: PenTool, name: "penTool" },
  pencil: { icon: Pencil, name: "pencil" },
  feather: { icon: Feather, name: "feather" },
  languages: { icon: Languages, name: "languages" },
  "graduation-cap": { icon: GraduationCap, name: "graduationCap" },
  school: { icon: School, name: "school" },
  presentation: { icon: Presentation, name: "presentation" },
  award: { icon: Award, name: "award" },
  trophy: { icon: Trophy, name: "trophy" },
  lightbulb: { icon: Lightbulb, name: "lightbulb" },
  landmark: { icon: Landmark, name: "landmark" },
  target: { icon: Target, name: "target" },
  layers: { icon: Layers, name: "layers" },
  compass: { icon: Compass, name: "compass" },
  map: { icon: MapIcon, name: "map" },
  ruler: { icon: Ruler, name: "ruler" },
  wrench: { icon: Wrench, name: "wrench" },
  cog: { icon: Cog, name: "cog" },
  calendar: { icon: Calendar, name: "calendar" },
  timer: { icon: Timer, name: "timer" },
  hourglass: { icon: Hourglass, name: "hourglass" },
  "clipboard-list": { icon: ClipboardList, name: "clipboardList" },
  "list-checks": { icon: ListChecks, name: "listChecks" },
};

export type ItemKind = ArtifactKind | "note";

export interface KindTone {
  icon: string;
  text: string;
  tint: string;
  dot: string;
}

export const KIND_TONES: Readonly<Record<ItemKind, KindTone>> = {
  note: {
    icon: "text-violet-600 dark:text-violet-400",
    text: "text-violet-700 dark:text-violet-300",
    tint: "bg-violet-500/10",
    dot: "bg-violet-500",
  },
  figure: {
    icon: "text-pink-600 dark:text-pink-400",
    text: "text-pink-700 dark:text-pink-300",
    tint: "bg-pink-500/10",
    dot: "bg-pink-500",
  },
  html: {
    icon: "text-orange-600 dark:text-orange-400",
    text: "text-orange-700 dark:text-orange-300",
    tint: "bg-orange-500/10",
    dot: "bg-orange-500",
  },
  data: {
    icon: "text-emerald-600 dark:text-emerald-400",
    text: "text-emerald-700 dark:text-emerald-300",
    tint: "bg-emerald-500/10",
    dot: "bg-emerald-500",
  },
  report: {
    icon: "text-sky-600 dark:text-sky-400",
    text: "text-sky-700 dark:text-sky-300",
    tint: "bg-sky-500/10",
    dot: "bg-sky-500",
  },
  notebook: {
    icon: "text-amber-600 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-300",
    tint: "bg-amber-500/10",
    dot: "bg-amber-500",
  },
  file: {
    icon: "text-slate-600 dark:text-slate-400",
    text: "text-slate-700 dark:text-slate-300",
    tint: "bg-slate-500/10",
    dot: "bg-slate-500",
  },
};

export const NOTE_COLOR_HEX = Object.fromEntries(
  BOOK_COLOR_OPTIONS.map(({ name, hex }) => [name.toLowerCase(), hex]),
) as Readonly<Record<NoteColor, string>>;

export const NOTE_COLOR_LABELS = Object.fromEntries(
  BOOK_COLOR_OPTIONS.map(({ name }) => [name.toLowerCase(), name]),
) as Readonly<Record<NoteColor, string>>;

const DEFAULT_TONE: NoteColor = "blue";

export function noteColorStyle(color: string | undefined): CSSProperties {
  return { "--note-color": NOTE_COLOR_HEX[toneOf(color)] } as CSSProperties;
}

export type NoteIconSize = "sm" | "md" | "lg";

const ICON_SIZES: Readonly<Record<NoteIconSize, { line: string; emoji: string }>> = {
  sm: { line: "size-3.5", emoji: "text-sm" },
  md: { line: "size-4", emoji: "text-base" },
  lg: { line: "size-8", emoji: "text-[2rem]" },
};

const CHIP_SIZES: Readonly<Record<NoteIconSize, string>> = {
  sm: "size-6 rounded-md",
  md: "size-8 rounded-lg",
  lg: "size-14 rounded-xl",
};

function lineIcon(icon: string): LucideIcon | null {
  if (!icon.startsWith(LINE_ICON_PREFIX)) return null;
  const id = icon.slice(LINE_ICON_PREFIX.length);
  return Object.hasOwn(LINE_ICONS, id) ? LINE_ICONS[id].icon : NotebookPen;
}

export function NoteIcon({
  icon,
  size = "sm",
  className,
}: Readonly<{ icon?: string; size?: NoteIconSize; className?: string }>) {
  const Icon = icon ? lineIcon(icon) : NotebookPen;
  if (!Icon) {
    return (
      <span aria-hidden className={cn("shrink-0 leading-none", ICON_SIZES[size].emoji)}>
        {icon}
      </span>
    );
  }
  return (
    <Icon
      aria-hidden
      className={cn("shrink-0", ICON_SIZES[size].line, size === "lg" ? "text-foreground" : "text-muted-foreground", className)}
    />
  );
}

function toneOf(color: string | undefined): NoteColor {
  return color !== undefined && Object.hasOwn(NOTE_COLOR_HEX, color) ? (color as NoteColor) : DEFAULT_TONE;
}

export function NoteChip({
  icon,
  color,
  size = "sm",
  className,
}: Readonly<{ icon?: string; color?: string; size?: NoteIconSize; className?: string }>) {
  const tone = toneOf(color);
  return (
    <span
      aria-hidden
      data-note-color={tone}
      style={noteColorStyle(tone)}
      className={cn("note-chip flex shrink-0 items-center justify-center", CHIP_SIZES[size], className)}
    >
      <NoteIcon icon={icon} size={size} className="text-current" />
    </span>
  );
}

const ARTIFACT_ICONS: Readonly<Record<ArtifactKind, LucideIcon>> = {
  figure: Image,
  data: Database,
  file: File,
  html: Braces,
  notebook: NotebookTabs,
  report: FileText,
};

export function artifactIcon(kind: ArtifactKind): ReactNode {
  const Icon = ARTIFACT_ICONS[kind];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", KIND_TONES[kind].icon)} />;
}

export function KindChip({
  kind,
  shape = "square",
  className,
  children,
}: Readonly<{ kind: ItemKind; shape?: "square" | "circle"; className?: string; children?: ReactNode }>) {
  return (
    <span
      data-kind={kind}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center",
        shape === "circle" ? "rounded-full" : "rounded-md",
        KIND_TONES[kind].tint,
        className,
      )}
    >
      {children ?? (kind === "note" ? <NoteIcon className={KIND_TONES.note.icon} /> : artifactIcon(kind))}
    </span>
  );
}

export function KindBadge({ kind, label }: Readonly<{ kind: ArtifactKind; label: string }>) {
  return (
    <Badge variant="muted" size="sm" data-kind={kind} className={cn("gap-1 [&_svg]:size-3", KIND_TONES[kind].tint, KIND_TONES[kind].text)}>
      {artifactIcon(kind)}
      {label}
    </Badge>
  );
}

export function AgentTag({ name }: Readonly<{ name: string }>) {
  return (
    <Badge variant="primaryGhost" size="sm" data-agent-tag className="min-w-0 max-w-[10rem] shrink">
      <span className="truncate">{name}</span>
    </Badge>
  );
}

export function Byline({
  author,
  agent,
  when,
  className,
  shared = false,
}: Readonly<{ author: Author; agent?: string; when: string; className?: string; shared?: boolean }>) {
  const { t } = useTranslation(["notes"]);
  if (author === "you" && shared) return <span className={cn("block truncate", className)}>{when}</span>;
  if (author === "you") {
    return <span className={cn("block truncate", className)}>{`${t(($) => $.notes.library.author.you)} · ${when}`}</span>;
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <AgentTag name={agent ?? t(($) => $.notes.library.agentFallback)} />
      <span className="truncate">{` · ${when}`}</span>
    </span>
  );
}

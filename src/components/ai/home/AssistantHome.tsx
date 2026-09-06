import { memo, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Glasses,
  Image as ImageIcon,
  Library,
  Lock,
  Presentation,
  Search,
  Send,
  Sparkles,
  Wrench,
} from "lucide-react";
import { groupSkills, type SkillGroup } from "@/lib/skill-groups";
import { isSkillAvailable, type SkillEntry } from "@/lib/skills";
import { cn } from "@/lib/utils";
import { useMarquee } from "./use-marquee";

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

interface ShelfEntry {
  key: string;
  testId: string;
  label: string;
  title: string;
  icon?: IconComponent;
  locked: boolean;
  onSelect: () => void;
}

export interface HomeQuickStart {
  id: string;
  label: string;
  icon?: IconComponent;
  onSelect: () => void;
}

const GROUP_ICONS: Record<string, IconComponent> = {
  research: Search,
  authoring: BookOpen,
  figures: ImageIcon,
  review: Glasses,
  submission: Send,
  communication: Presentation,
  tooling: Wrench,
  user: Sparkles,
  shelf: Library,
};

const TONES = [
  { icon: "text-amber-500", border: "border-amber-500/60", glow: "from-amber-500/10" },
  { icon: "text-rose-500", border: "border-rose-500/60", glow: "from-rose-500/10" },
  { icon: "text-violet-500", border: "border-violet-500/60", glow: "from-violet-500/10" },
  { icon: "text-sky-500", border: "border-sky-500/60", glow: "from-sky-500/10" },
  { icon: "text-emerald-500", border: "border-emerald-500/60", glow: "from-emerald-500/10" },
  { icon: "text-orange-500", border: "border-orange-500/60", glow: "from-orange-500/10" },
  { icon: "text-teal-500", border: "border-teal-500/60", glow: "from-teal-500/10" },
  { icon: "text-fuchsia-500", border: "border-fuchsia-500/60", glow: "from-fuchsia-500/10" },
];

function tone(index: number) {
  return TONES[index % TONES.length];
}

const CARD_COUNT = 3;

export function skillLocked(skill: SkillEntry): boolean {
  return !isSkillAvailable(skill);
}

export function homeSkillGroups(skills: readonly SkillEntry[]): SkillGroup[] {
  return groupSkills(skills.filter((skill) => skill.validation.status === "valid"));
}

function AssistantHomeView({
  heading = "What would you like to do today?",
  accent = "do today?",
  subtitle,
  skills,
  onPickSkill,
  onOpenSkills,
  quickStarts,
  quickStartTestId = "chat-suggestion",
  showSkills = true,
  before,
  children,
}: {
  heading?: string;
  accent?: string;
  subtitle?: ReactNode;
  skills: readonly SkillEntry[];
  onPickSkill: (skill: SkillEntry) => void;
  onOpenSkills?: () => void;
  quickStarts?: readonly HomeQuickStart[];
  quickStartTestId?: string;
  showSkills?: boolean;
  before?: ReactNode;
  children?: ReactNode;
}) {
  const groups = useMemo(() => homeSkillGroups(skills), [skills]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  useEffect(() => {
    if (groups.length === 0) {
      setActiveKey(null);
      return;
    }
    setActiveKey((current) =>
      current && groups.some((group) => group.key === current) ? current : groups[0].key,
    );
  }, [groups]);
  const active = groups.find((group) => group.key === activeKey) ?? groups[0] ?? null;
  const cards = active ? active.skills.slice(0, CARD_COUNT) : [];
  const chips = active ? active.skills.slice(CARD_COUNT) : [];
  const accentIndex = accent ? heading.lastIndexOf(accent) : -1;
  const plain = accentIndex >= 0 ? heading.slice(0, accentIndex) : heading;
  const pick = (skill: SkillEntry) => {
    if (skillLocked(skill)) {
      onOpenSkills?.();
      return;
    }
    onPickSkill(skill);
  };
  const sliderRef = useRef<HTMLDivElement>(null);
  const groupIcon = GROUP_ICONS[active?.key ?? "user"] ?? Sparkles;
  const shelf: ShelfEntry[] = [
    ...chips.map((skill) => ({
      key: `skill:${skill.id}`,
      testId: `assistant-home-chip-${skill.id}`,
      label: skill.name,
      title: skillLocked(skill)
        ? `${skill.name} is turned off for this project`
        : skill.description,
      icon: groupIcon,
      locked: skillLocked(skill),
      onSelect: () => pick(skill),
    })),
    ...(quickStarts ?? []).map((start) => ({
      key: `start:${start.id}`,
      testId: quickStartTestId,
      label: start.label,
      title: start.label,
      icon: start.icon,
      locked: false,
      onSelect: start.onSelect,
    })),
  ];

  const marquee = useMarquee(sliderRef, showSkills && shelf.length > 1);

  return (
    <div
      data-testid="assistant-home"
      className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5 px-1 py-6 [container-type:inline-size]"
    >
      <div className="flex h-28 w-full shrink-0 items-center justify-center">{before}</div>
      <div className="space-y-1 text-center">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
          {plain}
          {accentIndex >= 0 ? (
            <span className="bg-gradient-to-r from-foreground/70 via-primary to-primary bg-clip-text text-transparent">
              {accent}
            </span>
          ) : null}
        </h2>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>

      {showSkills && groups.length > 1 ? (
        <div
          role="tablist"
          aria-label="Skill categories"
          className="no-scrollbar flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border bg-muted/60 p-1"
        >
          {groups.map((group) => {
            const selected = group.key === active?.key;
            return (
              <button
                key={group.key}
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={`assistant-home-tab-${group.key}`}
                onClick={() => setActiveKey(group.key)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors",
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {group.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {showSkills && cards.length > 0 ? (
        <div
          data-testid="assistant-home-cards"
          className="grid w-full gap-2.5 @md:grid-cols-2 @2xl:grid-cols-3"
        >
          {cards.map((skill, index) => {
            const cardTone = tone(index);
            const Icon = GROUP_ICONS[active?.key ?? "user"] ?? Sparkles;
            const locked = skillLocked(skill);
            return (
              <button
                key={skill.id}
                type="button"
                data-testid={`assistant-home-card-${skill.id}`}
                data-locked={locked ? "true" : undefined}
                title={locked ? `${skill.name} is turned off for this project` : skill.description}
                onClick={() => pick(skill)}
                className={cn(
                  "group relative flex min-h-[6.5rem] flex-col items-start gap-1.5 overflow-hidden rounded-xl border bg-card p-3.5 text-left shadow-sm transition-shadow hover:shadow-md",
                  cardTone.border,
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent",
                    cardTone.glow,
                  )}
                />
                <span className="relative flex w-full items-start gap-2">
                  <Icon aria-hidden className={cn("mt-px size-4 shrink-0", cardTone.icon)} />
                  <span className="min-w-0 flex-1 text-balance text-sm font-semibold leading-snug text-foreground">
                    {skill.name}
                  </span>
                  {locked ? (
                    <Lock aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground/70" />
                  ) : (
                    <ArrowUpRight aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground/40" />
                  )}
                </span>
                <span className="relative line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {skill.description}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {showSkills && shelf.length > 0 ? (
        <div className="relative w-full">
          <div
            ref={sliderRef}
            data-testid="assistant-home-chips"
            data-marquee={marquee.running ? "running" : "paused"}
            className="no-scrollbar flex w-full items-center gap-2 overflow-x-auto px-0.5 py-1"
            {...marquee.handlers}
          >
            {shelf.map((entry, index) => {
              const chipTone = tone(cards.length + index);
              const Icon = entry.icon;
              return (
                <button
                  key={entry.key}
                  type="button"
                  data-testid={entry.testId}
                  data-locked={entry.locked ? "true" : undefined}
                  title={entry.title}
                  onClick={entry.onSelect}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-shadow hover:shadow-md",
                    chipTone.border,
                  )}
                >
                  {Icon ? <Icon aria-hidden className={cn("size-3.5", chipTone.icon)} /> : null}
                  <span className="whitespace-nowrap">{entry.label}</span>
                  {entry.locked ? (
                    <Lock aria-hidden className="size-3 text-muted-foreground/70" />
                  ) : null}
                </button>
              );
            })}
          </div>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-sidebar to-transparent"
          />
        </div>
      ) : null}

      {children}
    </div>
  );
}

export const AssistantHome = memo(AssistantHomeView);

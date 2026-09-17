export const SECTIONING_COMMANDS = [
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
] as const;

export type SectioningCommand = (typeof SECTIONING_COMMANDS)[number];

const HEADING_LEVELS: Record<SectioningCommand, number> = {
  part: 1,
  chapter: 1,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
};

const LEVEL_COMMANDS: SectioningCommand[] = [
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
];

export function isSectioningCommand(name: string): name is SectioningCommand {
  return Object.hasOwn(HEADING_LEVELS, name);
}

export function headingLevelForCommand(command: SectioningCommand): number {
  return HEADING_LEVELS[command];
}

export function headingCommandForLevel(level: number): SectioningCommand {
  const index = Math.min(Math.max(Math.trunc(level), 1), LEVEL_COMMANDS.length) - 1;
  return LEVEL_COMMANDS[index];
}

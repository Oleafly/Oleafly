export type ResumeSectionId =
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "summary"
  | "certifications"
  | "awards"
  | "publications"
  | "activities"
  | "interests"
  | "contact"
  | "references"
  | "leadership"
  | "volunteer"
  | "coursework"
  | "achievements";

export interface AtsSectionDefinition {
  id: Extract<ResumeSectionId, "experience" | "education" | "skills" | "projects" | "summary">;
  name: "Experience" | "Education" | "Skills" | "Projects" | "Summary";
  required: boolean;
}

export const ATS_SECTION_DEFINITIONS: readonly AtsSectionDefinition[] = [
  { id: "experience", name: "Experience", required: true },
  { id: "education", name: "Education", required: false },
  { id: "skills", name: "Skills", required: false },
  { id: "projects", name: "Projects", required: false },
  { id: "summary", name: "Summary", required: false },
];

const PROJECT_PREFIXES = [
  "personal",
  "academic",
  "selected",
  "key",
  "notable",
  "side",
  "technical",
  "relevant",
  "open source",
  "github",
  "software",
  "research",
  "engineering",
  "portfolio",
  "professional",
  "independent",
  "freelance",
  "capstone",
  "featured",
] as const;

const PROJECT_ALIASES = [
  "project",
  "projects",
  ...PROJECT_PREFIXES.flatMap((prefix) => [`${prefix} project`, `${prefix} projects`]),
];

const SECTION_ALIASES: Readonly<Record<ResumeSectionId, readonly string[]>> = {
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "relevant experience",
    "employment",
    "employment history",
  ],
  education: ["education"],
  skills: [
    "skills",
    "technical skills",
    "core skills",
    "key skills",
    "technologies",
  ],
  projects: PROJECT_ALIASES,
  summary: ["summary", "objective", "profile", "about"],
  certifications: ["certification", "certifications"],
  awards: ["award", "awards", "honor", "honors", "honour", "honours"],
  publications: ["publication", "publications"],
  activities: ["activity", "activities"],
  interests: ["interest", "interests"],
  contact: ["contact", "contact information"],
  references: ["reference", "references"],
  leadership: ["leadership"],
  volunteer: ["volunteer", "volunteering", "volunteer experience"],
  coursework: ["coursework", "relevant coursework"],
  achievements: ["achievement", "achievements"],
};

/**
 * Normalize a complete heading candidate, not arbitrary prose. Removing
 * separators lets PDF runs such as `GitHubProjects` match the same canonical
 * alias as `GitHub Projects`, while retaining every letter and digit prevents
 * substring matches such as `Projects I built at GitHub`.
 */
export function normalizeResumeSectionHeading(value: string): string {
  return value
    .normalize("NFKC")
    .replaceAll("\0", "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const ALIAS_TO_SECTION = new Map<string, ResumeSectionId>();
for (const [id, aliases] of Object.entries(SECTION_ALIASES) as Array<
  [ResumeSectionId, readonly string[]]
>) {
  for (const alias of aliases) {
    const normalized = normalizeResumeSectionHeading(alias);
    const previous = ALIAS_TO_SECTION.get(normalized);
    if (previous && previous !== id) {
      throw new Error(`Ambiguous resume section alias: ${alias}`);
    }
    ALIAS_TO_SECTION.set(normalized, id);
  }
}

export function matchResumeSectionHeading(value: string): ResumeSectionId | null {
  const normalized = normalizeResumeSectionHeading(value);
  return normalized ? (ALIAS_TO_SECTION.get(normalized) ?? null) : null;
}

export function isAtsResumeSection(
  id: ResumeSectionId | null,
): id is AtsSectionDefinition["id"] {
  return ATS_SECTION_DEFINITIONS.some((section) => section.id === id);
}

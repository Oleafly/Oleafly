import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { ToolSet } from "@/lib/chat-types";

export type SkillSource = "bundled" | "catalog" | "user";

export type SkillTier = "native" | "vendored" | "shelf" | "user";

export type SkillValidation =
  | { status: "valid" }
  | {
      status: "invalid";
      code:
        | "missing-skill-file"
        | "unreadable-skill-file"
        | "skill-too-large"
        | "invalid-frontmatter"
        | "missing-name"
        | "invalid-name"
        | "missing-description"
        | "invalid-description"
        | "missing-instructions"
        | "unsafe-path";
      message: string;
    };

export interface SkillFile {
  path: string;
  bytes: number;
}

export interface SkillFileContent {
  path: string;
  content: string;
  truncated: boolean;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  instructions: string;
  dir: string;
  files: SkillFile[];
  license?: string | null;
  compatibility?: string | null;
  allowedTools: string[];
  version?: string | null;
  author?: string | null;
  tier: SkillTier;
  phase?: string | null;
  tools: string[];
  source: SkillSource;
  packVersion?: string | null;
  updateAvailable: boolean;
  projectEnabled: boolean;
  enabled: boolean;
  removable: boolean;
  validation: SkillValidation;
}

export interface CreateSkillInput {
  name: string;
  description: string;
  instructions?: string;
}

export interface UpdateSkillInput {
  name: string;
  description: string;
  instructions: string;
}

export interface SkillDraftSource {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    reasoning?: unknown;
    toolCalls?: unknown;
    attachments?: unknown;
  }>;
  todos: Array<{ content: string; status: string }>;
}

export interface RecordedSkillDraft extends CreateSkillInput {
  instructions: string;
}

export const SKILLS_QUERY_KEY = ["skills"] as const;

export function skillsQueryKey(projectId?: string | null) {
  return [...SKILLS_QUERY_KEY, projectId ?? null] as const;
}

export function loadSkills(projectId?: string | null): Promise<SkillEntry[]> {
  return invoke<SkillEntry[]>("skills_list", { projectId: projectId ?? null });
}

export function addSkill(sourcePath: string): Promise<SkillEntry> {
  return invoke<SkillEntry>("skills_add", { sourcePath });
}

export function createSkill(input: CreateSkillInput): Promise<SkillEntry> {
  return invoke<SkillEntry>("skills_create", { input });
}

export function updateSkill(id: string, input: UpdateSkillInput): Promise<SkillEntry> {
  return invoke<SkillEntry>("skills_update", { id, input });
}

export function validateSkill(id: string): Promise<SkillEntry> {
  return invoke<SkillEntry>("skills_validate", { id });
}

export function setSkillEnabled(id: string, enabled: boolean): Promise<SkillEntry> {
  return invoke<SkillEntry>("skills_set_enabled", { id, enabled });
}

export function setSkillProjectEnabled(
  projectId: string,
  id: string,
  enabled: boolean,
): Promise<SkillEntry> {
  return invoke<SkillEntry>("skills_set_project_enabled", { projectId, id, enabled });
}

export function readSkillFile(id: string, path: string): Promise<SkillFileContent> {
  return invoke<SkillFileContent>("skills_read_file", { id, path });
}

export function updateBuiltinSkill(id: string): Promise<SkillEntry> {
  return invoke<SkillEntry>("skills_update_builtin", { id });
}

export async function resetSkillPreferences(
  projectId?: string | null,
): Promise<SkillEntry[]> {
  const skills = await loadSkills(projectId);
  const cleared = new Set<string>();
  await Promise.all(
    skills.map(async (skill) => {
      if (skill.enabled) {
        await setSkillEnabled(skill.id, false);
        cleared.add(skill.id);
      }
      if (projectId && skill.projectEnabled) {
        await setSkillProjectEnabled(projectId, skill.id, false);
        cleared.add(skill.id);
      }
    }),
  );
  return skills.map((skill) =>
    cleared.has(skill.id) ? { ...skill, enabled: false, projectEnabled: false } : skill,
  );
}

export function removeSkill(id: string): Promise<void> {
  return invoke<void>("skills_remove", { id });
}

export function useSkills(projectId?: string | null) {
  return useQuery({
    queryKey: skillsQueryKey(projectId),
    queryFn: () => loadSkills(projectId),
    staleTime: 60_000,
    meta: { silent: true },
  });
}

export function validSkills(skills: readonly SkillEntry[]): SkillEntry[] {
  return skills.filter((skill) => skill.validation.status === "valid");
}

export function enabledSkills(skills: readonly SkillEntry[]): SkillEntry[] {
  return validSkills(skills).filter((skill) => skill.enabled || skill.projectEnabled);
}

const PHASE_ORDER = [
  "research",
  "authoring",
  "figures",
  "review",
  "submission",
  "communication",
  "tooling",
] as const;

const RESEARCH_LOOP_SKILL_ID = "oleafly-research-loop";

function phaseKey(skill: SkillEntry): string {
  const phase = (skill.phase ?? "").trim().toLowerCase();
  return phase || "other";
}

function phaseRank(phase: string): number {
  const index = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
  if (index >= 0) return index;
  return phase === "other" ? PHASE_ORDER.length + 1 : PHASE_ORDER.length;
}

export function skillCatalogPrompt(skills: readonly SkillEntry[]): string {
  const enabled = enabledSkills(skills);
  if (enabled.length === 0) return "";
  const byPhase = new Map<string, SkillEntry[]>();
  for (const skill of enabled) {
    const phase = phaseKey(skill);
    const group = byPhase.get(phase);
    if (group) group.push(skill);
    else byPhase.set(phase, [skill]);
  }
  const phases = Array.from(byPhase.keys()).sort((left, right) => {
    const rank = phaseRank(left) - phaseRank(right);
    return rank !== 0 ? rank : left.localeCompare(right);
  });
  const blocks = phases.map((phase) => {
    const entries = (byPhase.get(phase) ?? []).map((skill) =>
      JSON.stringify({
        id: skill.id.slice(0, 100),
        name: skill.name.slice(0, 100),
        phase,
        description: skill.description.slice(0, 400),
      }),
    );
    return `## ${phase}\n${entries.join("\n")}`;
  });
  const loopEnabled = enabled.some((skill) => skill.id === RESEARCH_LOOP_SKILL_ID);
  const rules = [
    loopEnabled
      ? `For any research task that spans more than one step, call load_skill with "${RESEARCH_LOOP_SKILL_ID}" first and follow the handoffs it names.`
      : "For any research task that spans more than one step, load the skill for the stage you are starting before you do the work.",
    "Load the skill that matches the phase you are about to start, then follow it.",
    "Never say you are using a skill before you have loaded it with load_skill.",
    "Vendored skills ship reference files and scripts. Read a listed file with read_skill_file, and run a script through run_command using the absolute dir that load_skill reports.",
  ];
  return `Research workflow map. Oleafly runs research writing as a loop: research, then authoring, then figures, then review, then submission, then communication, with tooling skills available at any stage. The skills enabled for this run are grouped below by phase.
<enabled_skills>
${blocks.join("\n")}
</enabled_skills>
${rules.map((rule) => `- ${rule}`).join("\n")}`;
}

export function skillDirectiveLine(skill: SkillEntry): string {
  return `Use the skill "${skill.name}" (${skill.id}) for this request.`;
}

export function requestedSkillPrompt(skills: readonly SkillEntry[]): string {
  if (skills.length === 0) return "";
  const blocks = skills.map(
    (skill) => `<requested_skill id=${JSON.stringify(skill.id)} name=${JSON.stringify(skill.name)}>
${skill.instructions}
</requested_skill>`,
  );
  return `The user asked for the skill below by name. Follow it for this request.
${blocks.join("\n")}`;
}

export function parseSkillCommand(
  text: string,
  skills: readonly SkillEntry[],
): { skill: SkillEntry; text: string } | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return null;
  let match: SkillEntry | null = null;
  for (const skill of validSkills(skills)) {
    const token = `/${skill.id}`;
    if (!trimmed.startsWith(token)) continue;
    const next = trimmed.charAt(token.length);
    if (next !== "" && !/\s/u.test(next)) continue;
    if (!match || skill.id.length > match.id.length) match = skill;
  }
  if (!match) return null;
  return { skill: match, text: trimmed.slice(match.id.length + 1).trim() };
}

export function steeredSkillText(
  text: string,
  skills: readonly SkillEntry[],
): string {
  const command = parseSkillCommand(text, skills);
  if (!command) return text;
  const loadable = enabledSkills(skills).some((skill) => skill.id === command.skill.id);
  const parts = [skillDirectiveLine(command.skill)];
  if (!loadable) parts.push(requestedSkillPrompt([command.skill]));
  if (command.text) parts.push(command.text);
  return parts.join("\n").trim();
}

export function upsertSkillRecord(
  records: readonly SkillEntry[] | undefined,
  next: SkillEntry,
): SkillEntry[] {
  const current = records ?? [];
  const found = current.some((skill) => skill.id === next.id);
  const updated = found
    ? current.map((skill) => (skill.id === next.id ? next : skill))
    : [...current, next];
  return updated.sort((left, right) => left.id.localeCompare(right.id));
}

export type SkillToggleScope = "device" | "project";

export function mergeToggledSkillRecord(
  records: readonly SkillEntry[] | undefined,
  next: SkillEntry,
  scope: SkillToggleScope,
): SkillEntry[] {
  const previous = (records ?? []).find((skill) => skill.id === next.id);
  if (!previous) return upsertSkillRecord(records, next);
  const merged: SkillEntry =
    scope === "device"
      ? { ...previous, enabled: next.enabled }
      : { ...previous, projectEnabled: next.projectEnabled };
  return upsertSkillRecord(records, merged);
}

function kilobytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024));
}

function skillAttribute(name: string, value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed ? ` ${name}=${JSON.stringify(trimmed)}` : "";
}

export function skillPayload(skill: SkillEntry): string {
  const header = `<skill id=${JSON.stringify(skill.id)}${skillAttribute("dir", skill.dir)}${skillAttribute(
    "license",
    skill.license,
  )}${skillAttribute("version", skill.version)}${skillAttribute("phase", skill.phase)}>`;
  const files =
    skill.files.length > 0
      ? `<files>
${skill.files.map((file) => `${file.path} (${kilobytes(file.bytes)} KB)`).join("\n")}
</files>
`
      : "";
  const dir = skill.dir.trim();
  const usage = dir
    ? `Usage:
- Read any file listed above with read_skill_file, for example read_skill_file({"id": ${JSON.stringify(skill.id)}, "path": "references/overview.md"}).
- Run a bundled script through run_command, for example: python3 "${dir}/scripts/example.py" --help
- Scripts need Python 3.11 or newer on PATH. Check once with python3 --version before you rely on them.
- Every path in the instructions is relative to ${dir}.
`
    : "";
  return `${header}
Name: ${skill.name}
Description: ${skill.description}
${files}<instructions>
${skill.instructions}
</instructions>
${usage}</skill>`;
}

function requestedSkillEntries(
  skills: readonly SkillEntry[],
  requestedIds: readonly string[],
): SkillEntry[] {
  if (requestedIds.length === 0) return [];
  const wanted = new Set(requestedIds);
  return validSkills(skills).filter((skill) => wanted.has(skill.id));
}

export function runSkillsFor(
  skills: readonly SkillEntry[],
  requestedIds: readonly string[] = [],
): SkillEntry[] {
  const available = enabledSkills(skills);
  const known = new Set(available.map((skill) => skill.id));
  for (const skill of requestedSkillEntries(skills, requestedIds)) {
    if (known.has(skill.id)) continue;
    known.add(skill.id);
    available.push(skill);
  }
  return available;
}

export function createLoadSkillTools(
  skills: readonly SkillEntry[],
  requestedIds: readonly string[] = [],
): ToolSet {
  const available = runSkillsFor(skills, requestedIds);
  if (available.length === 0) return {};
  const byId = new Map(available.map((skill) => [skill.id, skill]));
  const ids = available.map((skill) => skill.id);
  const resolve = (input: unknown, key: string): string =>
    input && typeof input === "object" && key in input
      ? String((input as Record<string, unknown>)[key])
      : "";
  return {
    load_skill: {
      description:
        "Load the full instructions, file list, and folder path for one available skill before using it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: {
            type: "string",
            enum: ids,
          },
        },
      },
      execute: async (input: unknown) => {
        const id = resolve(input, "id");
        const skill = byId.get(id);
        if (!skill) {
          return { error: `Skill "${id}" is not enabled for this run.` };
        }
        return skillPayload(skill);
      },
    },
    read_skill_file: {
      description:
        "Read one supporting file from a skill folder, using a path from the file list that load_skill returned.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id", "path"],
        properties: {
          id: {
            type: "string",
            enum: ids,
          },
          path: {
            type: "string",
            description: "Path inside the skill folder, relative to its dir.",
          },
        },
      },
      execute: async (input: unknown) => {
        const id = resolve(input, "id");
        const path = resolve(input, "path");
        if (!byId.has(id)) {
          return { error: `Skill "${id}" is not enabled for this run.` };
        }
        if (!path.trim()) {
          return { error: "Pass the path of a file listed by load_skill." };
        }
        try {
          return await readSkillFile(id, path);
        } catch (error) {
          return { error: String(error) };
        }
      },
    },
  };
}

function takeCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

function takeUtf8Bytes(value: string, max: number): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (bytes + size > max) break;
    result += character;
    bytes += size;
  }
  return result;
}

function compactText(value: string, max: number): string {
  return takeCodePoints(value.replace(/\s+/gu, " ").trim(), max).trim();
}

function draftName(goal: string): string {
  const words = goal
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 3);
  const name = words
    .map((word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`)
    .join(" ");
  return takeCodePoints(name || "Recorded Skill", 100);
}

function assistantProcedureSteps(content: string): string[] {
  const steps: string[] = [];
  let inProcedure = false;
  let captured = false;
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/u);
    if (heading) {
      if (captured) break;
      inProcedure = /^(?:approach|steps|procedure|process|workflow)\b/iu.test(heading[1]);
      continue;
    }
    if (!inProcedure) continue;
    const item = trimmed.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/u);
    if (item?.[1]?.trim()) {
      steps.push(item[1].trim());
      captured = true;
      continue;
    }
    if (captured && trimmed) break;
  }
  return steps;
}

export function draftSkillFromChat(source: SkillDraftSource): RecordedSkillDraft | null {
  let assistantIndex = -1;
  for (let index = source.messages.length - 1; index >= 0; index -= 1) {
    const message = source.messages[index];
    if (message.role === "assistant" && message.content.trim()) {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) return null;
  let userContent = "";
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = source.messages[index];
    if (message.role === "user" && message.content.trim()) {
      userContent = message.content;
      break;
    }
  }
  if (!userContent) return null;
  const assistantContent = source.messages[assistantIndex].content;
  const goal = compactText(userContent, 360);
  const completedTodos = source.todos
    .filter((todo) => todo.status === "completed" && todo.content.trim())
    .map((todo) => compactText(todo.content, 700));
  const explicitSteps = assistantProcedureSteps(assistantContent).map((step) =>
    compactText(step, 700),
  );
  const capturedSteps = (completedTodos.length > 0 ? completedTodos : explicitSteps)
    .filter(Boolean)
    .slice(0, 8);
  const steps =
    capturedSteps.length > 0
      ? capturedSteps
      : [
          "Review the source chat and identify the reusable method used for this request.",
          "Replace this scaffold with the concrete checks, tools, and sequence to repeat.",
          "Test the revised procedure on a similar request before enabling this skill.",
        ];
  const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const instructions = takeUtf8Bytes(`This draft was captured from a chat. Review and edit it before enabling the skill.

## When to use

Use this skill for requests like: ${goal}

## Steps

${numbered}`, 6_000);
  const description = takeUtf8Bytes(
    takeCodePoints(`Reuse the approach from this chat for: ${goal}`, 500),
    1_500,
  );
  return {
    name: draftName(goal),
    description,
    instructions,
  };
}

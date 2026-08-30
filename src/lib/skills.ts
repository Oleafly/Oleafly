import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { ToolSet } from "@/lib/chat-types";

export type SkillSource = "first-party" | "user";

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

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  instructions: string;
  source: SkillSource;
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
export const MAX_ENABLED_SKILLS = 32;

export function loadSkills(): Promise<SkillEntry[]> {
  return invoke<SkillEntry[]>("skills_list");
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

export function removeSkill(id: string): Promise<void> {
  return invoke<void>("skills_remove", { id });
}

export function useSkills() {
  return useQuery({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: loadSkills,
    staleTime: 60_000,
    meta: { silent: true },
  });
}

export function enabledSkills(skills: readonly SkillEntry[]): SkillEntry[] {
  return skills
    .filter((skill) => skill.enabled && skill.validation.status === "valid")
    .slice(0, MAX_ENABLED_SKILLS);
}

export function skillCatalogPrompt(skills: readonly SkillEntry[]): string {
  const enabled = enabledSkills(skills);
  if (enabled.length === 0) return "";
  const entries = enabled.map((skill) =>
    JSON.stringify({
      id: skill.id.slice(0, 100),
      name: skill.name.slice(0, 100),
      description: skill.description.slice(0, 500),
    }),
  );
  return `Enabled skills are listed below by id, name, and description. When a skill matches the request, call load_skill with its id before following it. Do not claim to use a skill before loading it.
<enabled_skills>
${entries.join("\n")}
</enabled_skills>`;
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

export function createLoadSkillTools(skills: readonly SkillEntry[]): ToolSet {
  const enabled = enabledSkills(skills);
  if (enabled.length === 0) return {};
  const byId = new Map(enabled.map((skill) => [skill.id, skill]));
  return {
    load_skill: {
      description: "Load the full instructions for one enabled skill before using it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: {
            type: "string",
            enum: enabled.map((skill) => skill.id),
          },
        },
      },
      execute: async (input: unknown) => {
        const id =
          input && typeof input === "object" && "id" in input
            ? String((input as { id: unknown }).id)
            : "";
        const skill = byId.get(id);
        if (!skill) {
          return { error: `Skill "${id}" is not enabled for this run.` };
        }
        return `<skill id=${JSON.stringify(skill.id)}>
Name: ${skill.name}
Description: ${skill.description}
<instructions>
${skill.instructions}
</instructions>
</skill>`;
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

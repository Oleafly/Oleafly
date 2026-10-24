import type { AttachmentKind, MentionItem, SlashItem } from "@/components/ai/composer/types";
import type { MentionEntry } from "@/components/ai/MentionMenu";
import { filterMentionEntries } from "@/components/ai/MentionMenu";
import type { AcpCommand, AcpSession } from "@/lib/acp";
import { trimTrailingCharacter } from "@/lib/trim-character";

/** What Enter does in the CLI composer. */
export type AcpComposerMode = "send" | "queue" | "start" | "blocked";

/** `sending`: a message is still on its way to the agent, so the next one
 * waits behind it instead of starting a second turn. */
export function composerMode(
  session: AcpSession | undefined,
  agentUsable: boolean,
  sending = false,
): AcpComposerMode {
  if (!session) return agentUsable ? "start" : "blocked";
  switch (session.status) {
    case "ready":
      return sending ? "queue" : "send";
    case "connecting":
    case "running":
    case "cancelling":
      return "queue";
    default:
      return "blocked";
  }
}

export interface SkillChoice {
  id: string;
  name: string;
  description?: string;
  valid?: boolean;
  available?: boolean;
}

/** The agent's own commands first, then the skills that can be attached. */
export function acpSlashItems(
  commands: readonly AcpCommand[],
  skills: readonly SkillChoice[],
  groups: { commands: string; skills: string },
): SlashItem[] {
  const items: SlashItem[] = commands.map((command) => ({
    id: `command:${command.name}`,
    label: `/${command.name}`,
    description: command.description || undefined,
    hint: command.hint ?? undefined,
    insertText: `/${command.name} `,
    command: command.name,
    group: groups.commands,
  }));
  for (const skill of skills) {
    if (skill.valid === false || skill.available === false) continue;
    items.push({
      id: `skill:${skill.id}`,
      label: skill.name,
      description: skill.description,
      insertText: "",
      group: groups.skills,
    });
  }
  return items;
}

function basename(path: string): string {
  const trimmed = trimTrailingCharacter(path, "/");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function parent(path: string): string | undefined {
  const trimmed = trimTrailingCharacter(path, "/");
  const slash = trimmed.lastIndexOf("/");
  return slash > 0 ? trimmed.slice(0, slash) : undefined;
}

export function acpMentionItems(entries: readonly MentionEntry[], query: string): MentionItem[] {
  return filterMentionEntries(entries, query).map((entry) => ({
    id: entry.path,
    label: basename(entry.path),
    kind: entry.isDir ? "folder" : "file",
    path: entry.path,
    detail: parent(entry.path),
  }));
}

/** Images go only to agents that accept them (any agent before a session exists). */
export function acpAttachmentKinds(session: AcpSession | undefined): AttachmentKind[] {
  return !session || session.capabilities.image ? ["image", "pdf", "text"] : ["pdf", "text"];
}

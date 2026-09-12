import {
  Archive,
  Bot,
  FolderOpen,
  GitFork,
  Lightbulb,
  PanelRightOpen,
  Sparkles,
  Target,
} from "lucide-react";
import type { ComponentType } from "react";
import { i18n } from "@/i18n";
import { McpBrandIcon } from "./McpBrandIcon";

export interface ComposerCommandActions {
  archiveChat?: () => void;
  attachFiles?: () => void;
  forkChat?: () => void;
  openBrowser: () => void;
  openGoalEditor?: () => void;
  openMcpSettings: () => void;
  openModelPicker?: () => void;
  planMode?: boolean;
  recordSkill?: () => void;
  togglePlanMode?: () => void;
}

export interface ComposerCommand {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  action: () => void;
  kind?: "action" | "insert";
  insertText?: string;
  group?: string;
  keywords?: string;
}

export function createSkillCommands(
  skills: readonly { id: string; name: string; description: string }[],
): ComposerCommand[] {
  return skills.map((skill) => ({
    id: `skill:${skill.id}`,
    label: skill.name,
    description: skill.description,
    icon: Sparkles,
    kind: "insert" as const,
    insertText: `/${skill.id} `,
    group: i18n.t(($) => $.ai.commands.groups.skills),
    keywords: skill.id,
    action: () => {},
  }));
}

export function createSlashCommands(actions: ComposerCommandActions): ComposerCommand[] {
  const commands: ComposerCommand[] = [];
  if (actions.archiveChat) {
    commands.push({
      id: "archive",
      label: i18n.t(($) => $.ai.commands.archive.label),
      description: i18n.t(($) => $.ai.commands.archive.description),
      icon: Archive,
      action: actions.archiveChat,
    });
  }
  if (actions.forkChat) {
    commands.push({
      id: "fork-chat",
      label: i18n.t(($) => $.ai.commands.forkChat.label),
      description: i18n.t(($) => $.ai.commands.forkChat.description),
      icon: GitFork,
      action: actions.forkChat,
    });
  }
  if (actions.openGoalEditor) {
    commands.push({
      id: "goal",
      label: i18n.t(($) => $.ai.commands.goal.label),
      description: i18n.t(($) => $.ai.commands.goal.description),
      icon: Target,
      action: actions.openGoalEditor,
    });
  }
  commands.push({
    id: "mcp",
    label: i18n.t(($) => $.ai.commands.mcp.label),
    description: i18n.t(($) => $.ai.commands.mcp.description),
    icon: McpBrandIcon,
    action: actions.openMcpSettings,
  });
  if (actions.openModelPicker) {
    commands.push({
      id: "model",
      label: i18n.t(($) => $.ai.commands.model.label),
      description: i18n.t(($) => $.ai.commands.model.description),
      icon: Bot,
      action: actions.openModelPicker,
    });
  }
  if (actions.togglePlanMode) {
    commands.push({
      id: "plan-mode",
      label: actions.planMode
        ? i18n.t(($) => $.ai.commands.planMode.disableLabel)
        : i18n.t(($) => $.ai.commands.planMode.enableLabel),
      description: i18n.t(($) => $.ai.commands.planMode.description),
      icon: Lightbulb,
      action: actions.togglePlanMode,
    });
  }
  if (actions.recordSkill) {
    commands.push({
      id: "record-skill",
      label: i18n.t(($) => $.ai.commands.recordSkill.label),
      description: i18n.t(($) => $.ai.commands.recordSkill.description),
      icon: Sparkles,
      action: actions.recordSkill,
    });
  }
  return commands;
}

export function createAttachCommands(actions: ComposerCommandActions): ComposerCommand[] {
  const commands: ComposerCommand[] = [];
  if (actions.attachFiles) {
    commands.push({
      id: "files",
      label: i18n.t(($) => $.ai.commands.files.label),
      description: i18n.t(($) => $.ai.commands.files.description),
      icon: FolderOpen,
      action: actions.attachFiles,
    });
  }
  commands.push({
    id: "browser",
    label: i18n.t(($) => $.ai.commands.browser.label),
    description: i18n.t(($) => $.ai.commands.browser.description),
    icon: PanelRightOpen,
    action: actions.openBrowser,
  });
  if (actions.openGoalEditor) {
    commands.push({
      id: "goal",
      label: i18n.t(($) => $.ai.commands.goal.label),
      description: i18n.t(($) => $.ai.commands.goal.description),
      icon: Target,
      action: actions.openGoalEditor,
    });
  }
  if (actions.togglePlanMode) {
    commands.push({
      id: "plan-mode",
      label: actions.planMode
        ? i18n.t(($) => $.ai.commands.planMode.disableLabel)
        : i18n.t(($) => $.ai.commands.planMode.enableLabel),
      description: i18n.t(($) => $.ai.commands.planMode.description),
      icon: Lightbulb,
      action: actions.togglePlanMode,
    });
  }
  if (actions.recordSkill) {
    commands.push({
      id: "record-skill",
      label: i18n.t(($) => $.ai.commands.recordSkill.label),
      description: i18n.t(($) => $.ai.commands.recordSkill.description),
      icon: Sparkles,
      action: actions.recordSkill,
    });
  }
  return commands;
}

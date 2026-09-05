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
    group: "Skills",
    keywords: skill.id,
    action: () => {},
  }));
}

export function createSlashCommands(actions: ComposerCommandActions): ComposerCommand[] {
  const commands: ComposerCommand[] = [];
  if (actions.archiveChat) {
    commands.push({
      id: "archive",
      label: "Archive",
      description: "Archive this chat",
      icon: Archive,
      action: actions.archiveChat,
    });
  }
  if (actions.forkChat) {
    commands.push({
      id: "fork-chat",
      label: "Fork chat",
      description: "Create a new chat from this conversation",
      icon: GitFork,
      action: actions.forkChat,
    });
  }
  if (actions.openGoalEditor) {
    commands.push({
      id: "goal",
      label: "Goal",
      description: "Set what the assistant should keep working toward",
      icon: Target,
      action: actions.openGoalEditor,
    });
  }
  commands.push({
    id: "mcp",
    label: "MCP",
    description: "View connected MCP servers and their status",
    icon: McpBrandIcon,
    action: actions.openMcpSettings,
  });
  if (actions.openModelPicker) {
    commands.push({
      id: "model",
      label: "Model",
      description: "Choose the model for this chat",
      icon: Bot,
      action: actions.openModelPicker,
    });
  }
  if (actions.togglePlanMode) {
    commands.push({
      id: "plan-mode",
      label: actions.planMode ? "Disable Plan Mode" : "Enable Plan Mode",
      description: "Turn structured planning on or off",
      icon: Lightbulb,
      action: actions.togglePlanMode,
    });
  }
  if (actions.recordSkill) {
    commands.push({
      id: "record-skill",
      label: "Record a skill",
      description: "Save this chat's approach as an editable draft",
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
      label: "Files",
      description: "Attach files to your next message",
      icon: FolderOpen,
      action: actions.attachFiles,
    });
  }
  commands.push({
    id: "browser",
    label: "Attach browser",
    description: "Open the browser beside your document",
    icon: PanelRightOpen,
    action: actions.openBrowser,
  });
  if (actions.openGoalEditor) {
    commands.push({
      id: "goal",
      label: "Goal",
      description: "Set what the assistant should keep working toward",
      icon: Target,
      action: actions.openGoalEditor,
    });
  }
  if (actions.togglePlanMode) {
    commands.push({
      id: "plan-mode",
      label: actions.planMode ? "Disable Plan Mode" : "Enable Plan Mode",
      description: "Turn structured planning on or off",
      icon: Lightbulb,
      action: actions.togglePlanMode,
    });
  }
  if (actions.recordSkill) {
    commands.push({
      id: "record-skill",
      label: "Record a skill",
      description: "Save this chat's approach as an editable draft",
      icon: Sparkles,
      action: actions.recordSkill,
    });
  }
  return commands;
}

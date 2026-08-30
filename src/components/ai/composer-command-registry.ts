import {
  Archive,
  Bot,
  FolderOpen,
  GitFork,
  Lightbulb,
  PanelRightOpen,
  Server,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";

export interface ComposerCommandActions {
  archiveChat?: () => void;
  attachFiles?: () => void;
  forkChat?: () => void;
  openBrowser: () => void;
  openGoalEditor?: () => void;
  openMcpSettings: () => void;
  openModelPicker?: () => void;
  openSkillsSettings: () => void;
  togglePlanMode?: () => void;
}

export interface ComposerCommand {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  action: () => void;
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
    icon: Server,
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
      label: "Plan mode",
      description: "Turn structured planning on or off",
      icon: Lightbulb,
      action: actions.togglePlanMode,
    });
  }
  commands.push({
    id: "record-skill",
    label: "Record a skill (coming soon)",
    description: "Open the Skills preview in Settings",
    icon: Sparkles,
    action: actions.openSkillsSettings,
  });
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
      label: "Plan mode",
      description: "Turn structured planning on or off",
      icon: Lightbulb,
      action: actions.togglePlanMode,
    });
  }
  commands.push({
    id: "record-skill",
    label: "Record a skill (coming soon)",
    description: "Open the Skills preview in Settings",
    icon: Sparkles,
    action: actions.openSkillsSettings,
  });
  return commands;
}

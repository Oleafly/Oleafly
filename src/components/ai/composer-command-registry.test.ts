import { describe, expect, it } from "vitest";
import {
  createAttachCommands,
  createSkillCommands,
  createSlashCommands,
  type ComposerCommandActions,
} from "./composer-command-registry";

type ActionName =
  | "archive-chat"
  | "attach-files"
  | "fork-chat"
  | "open-browser"
  | "open-goal"
  | "open-mcp"
  | "open-model"
  | "record-skill"
  | "toggle-plan";

function actionLayer(calls: ActionName[]): ComposerCommandActions {
  return {
    archiveChat: () => calls.push("archive-chat"),
    attachFiles: () => calls.push("attach-files"),
    forkChat: () => calls.push("fork-chat"),
    openBrowser: () => calls.push("open-browser"),
    openGoalEditor: () => calls.push("open-goal"),
    openMcpSettings: () => calls.push("open-mcp"),
    openModelPicker: () => calls.push("open-model"),
    recordSkill: () => calls.push("record-skill"),
    togglePlanMode: () => calls.push("toggle-plan"),
  };
}

describe("composer command registry", () => {
  it.each([
    ["archive", "archive-chat"],
    ["fork-chat", "fork-chat"],
    ["goal", "open-goal"],
    ["mcp", "open-mcp"],
    ["model", "open-model"],
    ["plan-mode", "toggle-plan"],
    ["record-skill", "record-skill"],
  ] as const)("dispatches the %s slash command to its real action", (id, expected) => {
    const calls: ActionName[] = [];
    const command = createSlashCommands(actionLayer(calls)).find((item) => item.id === id);

    command?.action();

    expect(calls).toEqual([expected]);
  });

  it("omits commands whose context-dependent action is unavailable", () => {
    const actions = actionLayer([]);
    actions.archiveChat = undefined;
    actions.attachFiles = undefined;
    actions.forkChat = undefined;
    actions.openGoalEditor = undefined;
    actions.openModelPicker = undefined;
    actions.recordSkill = undefined;
    actions.togglePlanMode = undefined;

    expect(createSlashCommands(actions).map((command) => command.id)).toEqual(["mcp"]);
    expect(createAttachCommands(actions).map((command) => command.id)).toEqual(["browser"]);
  });

  it("offers one insert command per skill, searchable by id", () => {
    const commands = createSkillCommands([
      { id: "paper-lookup", name: "Paper Lookup", description: "Search literature APIs." },
      { id: "peer-review", name: "Peer Review", description: "Review a manuscript." },
    ]);

    expect(commands.map((command) => command.id)).toEqual([
      "skill:paper-lookup",
      "skill:peer-review",
    ]);
    expect(commands[0]).toMatchObject({
      kind: "insert",
      insertText: "/paper-lookup ",
      group: "Skills",
      keywords: "paper-lookup",
      label: "Paper Lookup",
    });
  });

  it("keeps the built-in commands as plain actions", () => {
    for (const command of createSlashCommands(actionLayer([]))) {
      expect(command.kind, command.id).toBeUndefined();
      expect(command.insertText, command.id).toBeUndefined();
    }
  });

  it.each([
    ["files", "attach-files"],
    ["browser", "open-browser"],
    ["goal", "open-goal"],
    ["plan-mode", "toggle-plan"],
    ["record-skill", "record-skill"],
  ] as const)("dispatches the %s attach command to its real action", (id, expected) => {
    const calls: ActionName[] = [];
    const command = createAttachCommands(actionLayer(calls)).find((item) => item.id === id);

    command?.action();

    expect(calls).toEqual([expected]);
  });
});

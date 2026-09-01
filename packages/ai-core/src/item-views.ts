// The view-model union and render grouping: store items (see thread-items.ts)
// map into kebab-case view models, which group into named buckets the
// renderer assigns one component family each. Framework-free.

import type { PlanTodo, RecordedStoreItem, StoreItem, TurnRecord } from "./thread-items";

export type ViewItem =
  | { type: "user-message"; text: string; itemId: string }
  | { type: "assistant-message"; text: string; itemId: string; completed: boolean }
  | { type: "reasoning"; text: string; itemId: string; completed: boolean }
  | { type: "proposed-plan"; text: string; itemId: string }
  | {
      type: "exec";
      itemId: string;
      command: string[];
      cwd: string;
      output: string;
      exitCode: number | null;
      executionStatus: "inProgress" | "completed" | "failed" | "declined" | "interrupted";
    }
  | { type: "patch"; itemId: string; changes: unknown; status: string }
  | { type: "turn-diff"; unifiedDiff: string }
  | { type: "todo-list"; explanation: string | null; todos: PlanTodo[]; itemId: string }
  | { type: "plan-implementation"; planContent: string; completed: boolean; itemId: string }
  | {
      type: "mcp-tool-call";
      itemId: string;
      server: string;
      tool: string;
      status: string;
    }
  | {
      type: "dynamic-tool-call";
      itemId: string;
      tool: string;
      output: string | null;
      status: string;
    }
  | {
      type: "multi-agent-action";
      itemId: string;
      tool: string;
      result: unknown;
    }
  | {
      type: "subagent-activity";
      itemId: string;
      agentId: string;
      label: string;
      displayStatus: "active" | "updated" | "interrupted" | "completed";
    }
  | { type: "generated-image"; itemId: string; status: string; path: string | null }
  | { type: "image-view"; itemId: string; imagePaths: string[] }
  | { type: "web-search"; itemId: string; query: string; completed: boolean }
  | { type: "context-compaction"; itemId: string; droppedMessages: number; reason: string }
  | { type: "worktree-init"; itemId: string; outcome: string }
  | {
      type: "stream-error";
      itemId: string;
      message: string;
    }
  | {
      type: "system-error";
      itemId: string;
      message: string;
      errorInfo: string | null;
    }
  | {
      type: "automatic-approval-review";
      itemId: string;
      targetItemId: string;
      action: string;
      riskLevel: string;
    }
  | { type: "strict-review-notice"; itemId: string }
  | { type: "auto-review-interruption-warning"; itemId: string }
  | { type: "user-input-response"; itemId: string; requestId: string; answers: unknown }
  | {
      type: "mcp-server-elicitation";
      itemId: string;
      requestId: string;
      serverName: string;
      completed: boolean;
    }
  | { type: "permission-request"; itemId: string; requestId: string; response: string | null }
  | { type: "steering-user-message"; itemId: string; text: string; status: string }
  | { type: "steered"; itemId: string }
  | { type: "remote-task-created"; itemId: string; taskId: string }
  | { type: "personality-changed"; itemId: string; personality: string }
  | { type: "model-changed"; itemId: string; fromModel: string; toModel: string }
  | { type: "model-rerouted"; itemId: string; fromModel: string; toModel: string }
  | {
      type: "forked-from-conversation";
      itemId: string;
      sourceConversationId: string;
      sourceConversationTitle: string | null;
    }
  | { type: "hook-prompt"; itemId: string; prompt: string }
  | { type: "sleep"; itemId: string; durationMs: number };

export function subagentDisplayStatus(kind: string): "active" | "updated" | "interrupted" | "completed" {
  switch (kind) {
    case "started":
    case "thinking":
    case "tool":
      return "active";
    case "interacted":
      return "updated";
    case "interrupted":
      return "interrupted";
    default:
      return "completed";
  }
}

/** Map one store item into its view model. */
export function toViewItem(recorded: RecordedStoreItem, interrupted: boolean): ViewItem {
  const item: StoreItem = recorded.item;
  const itemId = recorded.id;
  switch (item.type) {
    case "hookPrompt":
      return { type: "hook-prompt", itemId, prompt: item.prompt };
    case "agentMessage":
      return { type: "assistant-message", itemId, text: item.text, completed: recorded.completed };
    case "plan":
      return { type: "proposed-plan", itemId, text: item.text };
    case "reasoning":
      return {
        type: "reasoning",
        itemId,
        text: item.summary.length > 0 ? item.summary.join("\n\n") : item.content.join(""),
        completed: recorded.completed,
      };
    case "commandExecution":
      return {
        type: "exec",
        itemId,
        command: item.command,
        cwd: item.cwd,
        output: item.aggregatedOutput,
        exitCode: item.exitCode,
        executionStatus:
          interrupted && item.status === "inProgress" ? "interrupted" : item.status,
      };
    case "fileChange":
      return { type: "patch", itemId, changes: item.changes, status: item.status };
    case "mcpToolCall":
      return {
        type: "mcp-tool-call",
        itemId,
        server: item.server,
        tool: item.tool,
        status: item.status,
      };
    case "dynamicToolCall":
      return {
        type: "dynamic-tool-call",
        itemId,
        tool: item.tool,
        output: item.output,
        status: item.status,
      };
    case "collabAgentToolCall":
      return { type: "multi-agent-action", itemId, tool: item.tool, result: item.result };
    case "subAgentActivity":
      return {
        type: "subagent-activity",
        itemId,
        agentId: item.agentId,
        label: item.label,
        displayStatus: subagentDisplayStatus(item.kind),
      };
    case "todo-list":
      return { type: "todo-list", itemId, explanation: item.explanation, todos: item.todos };
    case "planImplementation":
      return {
        type: "plan-implementation",
        itemId,
        planContent: item.planContent,
        completed: item.completed,
      };
    case "error":
      return item.willRetry
        ? { type: "stream-error", itemId, message: item.message }
        : {
            type: "system-error",
            itemId,
            message: item.message,
            errorInfo: item.errorInfo,
          };
    case "automaticApprovalReview":
      return {
        type: "automatic-approval-review",
        itemId,
        targetItemId: item.targetItemId,
        action: item.action,
        riskLevel: item.riskLevel,
      };
    case "strictReviewNotice":
      return { type: "strict-review-notice", itemId };
    case "remoteTaskCreated":
      return { type: "remote-task-created", itemId, taskId: item.taskId };
    case "personalityChanged":
      return { type: "personality-changed", itemId, personality: item.personality };
    case "forkedFromConversation":
      return {
        type: "forked-from-conversation",
        itemId,
        sourceConversationId: item.sourceConversationId,
        sourceConversationTitle: item.sourceConversationTitle,
      };
    case "modelChanged":
      return { type: "model-changed", itemId, fromModel: item.fromModel, toModel: item.toModel };
    case "modelRerouted":
      return { type: "model-rerouted", itemId, fromModel: item.fromModel, toModel: item.toModel };
    case "autoReviewInterruptionWarning":
      return { type: "auto-review-interruption-warning", itemId };
    case "userInputResponse":
      return { type: "user-input-response", itemId, requestId: item.requestId, answers: item.answers };
    case "mcpServerElicitation":
      return {
        type: "mcp-server-elicitation",
        itemId,
        requestId: item.requestId,
        serverName: item.serverName,
        completed: item.completed,
      };
    case "permissionRequest":
      return {
        type: "permission-request",
        itemId,
        requestId: item.requestId,
        response: item.response,
      };
    case "webSearch":
      return { type: "web-search", itemId, query: item.query, completed: item.completed };
    case "contextCompaction":
      return {
        type: "context-compaction",
        itemId,
        droppedMessages: item.droppedMessages,
        reason: item.reason,
      };
    case "worktreeInit":
      return { type: "worktree-init", itemId, outcome: item.outcome };
    case "userMessage":
      return { type: "user-message", itemId, text: item.text };
    case "steeringUserMessage":
      return { type: "steering-user-message", itemId, text: item.text, status: item.status };
    case "steered":
      return { type: "steered", itemId };
    case "imageGeneration":
      return { type: "generated-image", itemId, status: item.status, path: item.path };
    case "imageView":
      return { type: "image-view", itemId, imagePaths: item.imagePaths };
    case "enteredReviewMode":
    case "exitedReviewMode":
      // Review-mode transitions are metadata, not timeline entries.
      return { type: "steered", itemId };
    case "sleep":
      return { type: "sleep", itemId, durationMs: item.durationMs };
  }
}

/** Named buckets one rendered turn splits into. */
export interface RenderGroups {
  userItems: ViewItem[];
  agentItems: ViewItem[];
  /** The final assistant message, hoisted out of agentItems. */
  assistantItem: ViewItem | null;
  toolOutputItems: ViewItem[];
  postAssistantItems: ViewItem[];
  systemEventItem: ViewItem | null;
  subagentActivityItemGroups: ViewItem[][];
  todoListItem: ViewItem | null;
  proposedPlanItem: ViewItem | null;
  planImplementationItem: ViewItem | null;
  permissionRequestItems: ViewItem[];
  mcpServerElicitationItems: ViewItem[];
  modelChangedItems: ViewItem[];
  modelReroutedItems: ViewItem[];
  personalityChangedItems: ViewItem[];
  forkedFromConversationItems: ViewItem[];
}

const EMPTY_GROUPS: RenderGroups = {
  userItems: [],
  agentItems: [],
  assistantItem: null,
  toolOutputItems: [],
  postAssistantItems: [],
  systemEventItem: null,
  subagentActivityItemGroups: [],
  todoListItem: null,
  proposedPlanItem: null,
  planImplementationItem: null,
  permissionRequestItems: [],
  mcpServerElicitationItems: [],
  modelChangedItems: [],
  modelReroutedItems: [],
  personalityChangedItems: [],
  forkedFromConversationItems: [],
};

/** Split one turn's items into render buckets, preserving item order. */
export function splitIntoRenderGroups(record: TurnRecord): RenderGroups {
  const interrupted = record.status === "interrupted";
  const groups: RenderGroups = {
    ...EMPTY_GROUPS,
    userItems: [],
    agentItems: [],
    toolOutputItems: [],
    postAssistantItems: [],
    subagentActivityItemGroups: [],
    permissionRequestItems: [],
    mcpServerElicitationItems: [],
    modelChangedItems: [],
    modelReroutedItems: [],
    personalityChangedItems: [],
    forkedFromConversationItems: [],
  };

  let subagentRun: ViewItem[] | null = null;
  for (const recorded of record.items) {
    const view = toViewItem(recorded, interrupted);
    switch (view.type) {
      case "user-message":
      case "hook-prompt":
      case "steering-user-message":
        groups.userItems.push(view);
        break;
      case "assistant-message":
        // The last assistant message wins the hoisted slot; earlier ones
        // stay inline (multi-message turns).
        groups.agentItems.push(view);
        break;
      case "system-error":
        groups.systemEventItem = view;
        break;
      case "subagent-activity":
        if (view.displayStatus === "active" || subagentRun === null) {
          subagentRun = [];
          groups.subagentActivityItemGroups.push(subagentRun);
        }
        subagentRun.push(view);
        break;
      case "todo-list":
        groups.todoListItem = view;
        break;
      case "proposed-plan":
        groups.proposedPlanItem = view;
        break;
      case "plan-implementation":
        groups.planImplementationItem = view;
        break;
      case "permission-request":
        groups.permissionRequestItems.push(view);
        break;
      case "mcp-server-elicitation":
        groups.mcpServerElicitationItems.push(view);
        break;
      case "model-changed":
        groups.modelChangedItems.push(view);
        break;
      case "model-rerouted":
        groups.modelReroutedItems.push(view);
        break;
      case "personality-changed":
        groups.personalityChangedItems.push(view);
        break;
      case "forked-from-conversation":
        groups.forkedFromConversationItems.push(view);
        break;
      default:
        groups.toolOutputItems.push(view);
        break;
    }
  }

  // Hoist the final assistant message: it renders after the tool output;
  // anything after it becomes post-assistant output.
  let lastAssistantIndex = -1;
  groups.agentItems.forEach((item, index) => {
    if (item.type === "assistant-message") {
      lastAssistantIndex = index;
    }
  });
  if (lastAssistantIndex !== -1) {
    groups.assistantItem = groups.agentItems[lastAssistantIndex];
    groups.postAssistantItems = groups.agentItems.slice(lastAssistantIndex + 1);
    groups.agentItems = groups.agentItems.slice(0, lastAssistantIndex);
  }

  return groups;
}

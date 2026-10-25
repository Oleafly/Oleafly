export type ToolSet = Record<
  string,
  {
    description?: string;
    inputSchema?: unknown;
    execute?: (input: unknown) => Promise<unknown>;
  }
>;

export type TextPart = { type: "text"; text: string };
export type ImagePart = { type: "image"; image: string };
export type FilePart = { type: "file"; data: string; mediaType: string; name?: string };
/** A file in the attachment store, sent by reference and resolved by the run. */
export type AttachmentPart = { type: "attachment"; sha256: string; name: string; mime: string };
export type ReasoningPart = { type: "reasoning"; text: string };
export type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
};
export type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: { type: "text"; value: string };
};

export type UserContent = string | (TextPart | ImagePart | FilePart | AttachmentPart)[];
export type AssistantContent = string | (TextPart | ReasoningPart | ToolCallPart)[];
export type ToolContent = ToolResultPart[];

export type ModelMessage =
  | { role: "user"; content: UserContent }
  | { role: "assistant"; content: AssistantContent }
  | { role: "tool"; content: ToolContent };

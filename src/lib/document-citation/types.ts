import type { LiteratureRecord } from "@/lib/literature-search";

export interface DocumentParagraph {
  index: number;
  text: string;
}

export interface RankedLiteraturePaper {
  record: LiteratureRecord;
  score: number;
  reasoning: { for: string; against: string } | null;
}

export type CompleteChatFn = (args: {
  system: string;
  user: string;
  temperature: number;
  signal?: AbortSignal;
}) => Promise<string>;


import { useEffect, useMemo, useRef, useState } from "react";
import { logError } from "@/lib/log";
import type { MentionItem } from "./types";

function sameMentions(left: readonly MentionItem[], right: readonly MentionItem[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item.id === right[index].id && item.kind === right[index].kind)
  );
}

/**
 * What the mention menu lists for `query`. The host may answer at once or
 * later; a late answer shows only while it still fits the query.
 */
export function useMentionResults(
  mentionItems: ((query: string) => MentionItem[] | Promise<MentionItem[]>) | undefined,
  mentionQuery: string | null,
): readonly MentionItem[] {
  const result = useMemo(
    () => (mentionQuery === null || !mentionItems ? null : mentionItems(mentionQuery)),
    [mentionItems, mentionQuery],
  );
  const [asyncMentions, setAsyncMentions] = useState<{
    query: string;
    items: MentionItem[];
  } | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    if (result === null || Array.isArray(result) || mentionQuery === null) return;
    const mine = ++sequence.current;
    const query = mentionQuery;
    result.then(
      (items) => {
        if (mine !== sequence.current) return;
        setAsyncMentions((current) =>
          current?.query === query && sameMentions(current.items, items)
            ? current
            : { query, items },
        );
      },
      (error: unknown) => void logError("mention suggestions", error),
    );
  }, [mentionQuery, result]);
  if (Array.isArray(result)) return result;
  return asyncMentions?.query === mentionQuery ? asyncMentions.items : [];
}

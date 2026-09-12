import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TurnRecord } from "@oleafly/ai-core";
import { agentThreadRead } from "@/lib/agent-backend";
import { MessageItem } from "@/components/ai/chat-parts";
import type { RenderedMessage } from "@/components/ai/MessageList";
import { projectTurnRecords } from "@/components/ai/activity/turn-record-projection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TranscriptState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rows: RenderedMessage[] };

export function SessionTranscriptDialog({
  threadId,
  onClose,
}: Readonly<{
  threadId: string | null;
  onClose: () => void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const [state, setState] = useState<TranscriptState>({ status: "loading" });

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setState({ status: "loading" });
    agentThreadRead(threadId)
      .then((turns) => {
        if (!cancelled) {
          setState({ status: "ready", rows: projectTurnRecords(turns as unknown as TurnRecord[]) });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  return (
    <Dialog open={threadId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        data-testid="session-transcript-dialog"
        className="flex h-[min(85vh,800px)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-3 pr-12">
          <DialogTitle>{t(($) => $.ai.transcript.dialogTitle)}</DialogTitle>
          <DialogDescription>{t(($) => $.ai.transcript.dialogDescription)}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {state.status === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t(($) => $.ai.transcript.loading)}
            </p>
          )}
          {state.status === "error" && (
            <p className="text-sm text-muted-foreground">{t(($) => $.ai.transcript.failed)}</p>
          )}
          {state.status === "ready" && state.rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{t(($) => $.ai.transcript.empty)}</p>
          )}
          {state.status === "ready" && state.rows.length > 0 && (
            <div className="flex flex-col gap-3">
              {state.rows.map((row) => (
                <MessageItem
                  key={row.key}
                  msg={row.msg}
                  live={row.live}
                  expansionScope={`${threadId}:transcript:${row.key}`}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

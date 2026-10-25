import { Clock, Pencil, Quote, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AcpSession } from "@/lib/acp";
import { cn } from "@/lib/utils";
import { useAcpSessionsStore, type AcpQueuedPrompt } from "@/store/acp-sessions";
import { acpDraftId, restoreDraft } from "./AcpComposer";
import { settleSelectionQuotes } from "./selection-quote";

const EMPTY_QUEUE: AcpQueuedPrompt[] = [];

function preview(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

/** The skill, quotes and queued messages above the CLI composer. */
export function AcpComposerChips({
  projectId,
  session,
}: Readonly<{ projectId: string; session: AcpSession | undefined }>) {
  const { t } = useTranslation(["common", "ai"]);
  const composer = useAcpSessionsStore((state) => state.composers[projectId]);
  const queued = useAcpSessionsStore((state) => (session ? state.queues[session.id] ?? EMPTY_QUEUE : EMPTY_QUEUE));
  // A message on its way is already in the transcript; the queue shows only
  // what waits (or failed). The send ends with the turn, so it would
  // otherwise say "sends when the agent finishes" while the agent answers it.
  const queue = queued.filter((item) => !item.sending);
  const skill = composer?.skill ?? null;
  const selections = composer?.selections ?? [];
  if (!skill && selections.length === 0 && queue.length === 0) return null;
  const store = useAcpSessionsStore.getState;
  // The failed message goes back into the composer it came from, to change and send again.
  const editQueued = (item: AcpQueuedPrompt) => {
    if (!session) return;
    const { id: _id, sending: _sending, failed: _failed, ...draft } = item;
    store().removeQueued(session.id, item.id);
    restoreDraft(projectId, acpDraftId(projectId, session.agentId, session), draft);
  };
  const queueLabel = (item: AcpQueuedPrompt) => {
    if (item.failed) return t(($) => $.ai.acp.queue.sendFailed);
    switch (session?.status) {
      // A turn is on: the message waits for it to end.
      case "running":
      case "cancelling":
      case "ready":
        return t(($) => $.ai.acp.queue.queued);
      case "auth_required":
        return t(($) => $.ai.acp.queue.queuedSignIn);
      // Until the agent has connected there is no turn to wait for.
      default:
        return t(($) => $.ai.acp.queue.queuedConnecting);
    }
  };
  const steerable = !!session && session.status === "running" && !!session.capabilities.steering;
  return (
    <div className="mb-2 flex flex-col gap-1.5 px-3">
      {queue.map((item) => (
        <div
          key={item.id}
          data-testid="acp-queued"
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-card px-2 py-1 text-xs",
            item.failed && "border-destructive/50",
          )}
        >
          <Clock className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">
              {queueLabel(item)}
            </span>{" "}
            {preview(item.text)}
          </span>
          {steerable && !item.failed && item.attachments.length === 0 && item.selections.length === 0 && !item.skill && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => session && void store().steerQueued(projectId, session.id, item.id)}
            >
              <Send className="size-3" /> {t(($) => $.ai.acp.queue.sendNow)}
            </Button>
          )}
          {item.failed && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => session && void store().retryQueued(projectId, session.id, item.id)}
              >
                <RotateCcw /> {t(($) => $.ai.acp.queue.retry)}
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={() => editQueued(item)}>
                <Pencil /> {t(($) => $.ai.acp.queue.edit)}
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground"
            aria-label={t(($) => $.ai.acp.queue.remove)}
            onClick={() => session && store().removeQueued(session.id, item.id)}
          >
            <X />
          </Button>
        </div>
      ))}
      {(skill || selections.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {skill && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="acp-skill-chip"
              aria-label={t(($) => $.ai.presets.removeSkill, { name: skill.name })}
              onClick={() => store().setComposer(projectId, { skill: null })}
            >
              <Sparkles className="size-3" /> {skill.name} <X className="size-3" />
            </Button>
          )}
          {selections.map((selection) => (
            <Button
              key={selection.id}
              type="button"
              variant="outline"
              size="xs"
              data-testid="acp-selection-chip"
              aria-label={t(($) => $.ai.acp.composer.removeSelection, { label: selection.label })}
              onClick={() => {
                settleSelectionQuotes(projectId, [selection]);
                store().setComposer(projectId, {
                  selections: selections.filter((entry) => entry.id !== selection.id),
                });
              }}
            >
              <Quote className="size-3" /> {selection.label} <X className="size-3" />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

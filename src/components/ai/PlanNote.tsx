import { useTranslation } from "react-i18next";
import type { ChatPlanNote } from "@/store/chats";

/**
 * The note under a plan-mode reply that left no new plan. `onUse` adds the
 * "Use this as the plan" button, which makes the reply's numbered list the
 * plan awaiting approval.
 */
export function PlanNote({
  note,
  onUse,
}: Readonly<{ note: ChatPlanNote; onUse?: () => void }>) {
  const { t } = useTranslation(["common", "ai"]);
  return (
    <div
      data-testid="plan-note"
      className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] leading-snug text-muted-foreground"
    >
      <span>
        {note.kind === "unchanged"
          ? t(($) => $.ai.conversation.planUnchanged)
          : t(($) => $.ai.conversation.planMissing)}
      </span>
      {onUse && (
        <button
          type="button"
          onClick={onUse}
          className="rounded-md border border-border px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-accent focus-visible:border-primary focus-visible:bg-accent"
        >
          {t(($) => $.ai.conversation.usePlanFromReply)}
        </button>
      )}
    </div>
  );
}

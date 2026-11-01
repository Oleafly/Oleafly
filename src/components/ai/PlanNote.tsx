import { useTranslation } from "react-i18next";
import type { ChatPlanNote } from "@/store/chats";

export function PlanNote({ note }: Readonly<{ note: ChatPlanNote }>) {
  const { t } = useTranslation(["common", "ai"]);
  return (
    <div
      data-testid="plan-note"
      className="mt-1.5 px-1 text-[0.6875rem] leading-snug text-muted-foreground"
    >
      {note === "unchanged"
        ? t(($) => $.ai.conversation.planUnchanged)
        : t(($) => $.ai.conversation.planMissing)}
    </div>
  );
}

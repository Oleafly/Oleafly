import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";

export function NoMainDocumentHint() {
  const { t } = useTranslation(["shell"]);
  return (
    <p
      data-testid="no-main-document"
      className="mx-1.5 mt-1.5 flex shrink-0 items-start gap-2 rounded-md border border-dashed border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground"
    >
      <Star aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{t(($) => $.shell.openedFolder.noMain)}</span>
    </p>
  );
}

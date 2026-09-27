import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2, Plus } from "lucide-react";
import { OpenFolderNotice } from "@/components/library/OpenFolderNotice";
import { openFolderWithPicker } from "@/features/open-folder";
import { cn } from "@/lib/utils";
import { useOpenFolderFlowStore } from "@/store/open-folder-flow";

function StartChoice({
  icon,
  title,
  description,
  onClick,
  primary = false,
  disabled = false,
  testId,
  tour,
}: Readonly<{
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  testId: string;
  tour?: string;
}>) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      data-testid={testId}
      data-tour={tour}
      disabled={disabled}
      aria-describedby={descriptionId}
      onClick={onClick}
      className="group flex h-full min-h-32 flex-col items-start gap-3 rounded-2xl border border-border/70 bg-background/70 p-5 text-left shadow-sm backdrop-blur-xl transition-colors hover:border-primary/40 hover:bg-accent/60 focus-visible:border-primary/60 focus-visible:bg-accent/60 disabled:cursor-default disabled:opacity-60 dark:bg-background/50"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-10 items-center justify-center rounded-xl transition-colors",
          primary
            ? "bg-primary text-white"
            : "bg-primary/10 text-primary group-hover:bg-primary/15",
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

export function LibraryStartChoices({ onNewProject }: Readonly<{ onNewProject: () => void }>) {
  const { t } = useTranslation(["library"]);
  const opening = useOpenFolderFlowStore((state) => state.opening);
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="grid w-full gap-3 sm:grid-cols-2">
        <StartChoice
          testId="create-first-project"
          tour="new-project"
          primary
          icon={<Plus className="size-5" />}
          title={t(($) => $.library.start.newProjectTitle)}
          description={t(($) => $.library.start.newProjectDescription)}
          onClick={onNewProject}
        />
        <StartChoice
          testId="open-first-folder"
          disabled={opening}
          icon={
            opening ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <FolderOpen className="size-5" />
            )
          }
          title={t(($) => $.library.start.openFolderTitle)}
          description={t(($) => $.library.start.openFolderDescription)}
          onClick={() => void openFolderWithPicker()}
        />
      </div>
      <OpenFolderNotice />
    </div>
  );
}

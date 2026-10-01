import { useTranslation } from "react-i18next";
import { ChoiceCard } from "@/components/library/ChoiceCard";
import { OpenFolderNotice } from "@/components/library/OpenFolderNotice";
import { openFolderWithPicker } from "@/features/open-folder";
import { useOpenFolderFlowStore } from "@/store/open-folder-flow";

export function LibraryStartChoices({ onNewProject }: Readonly<{ onNewProject: () => void }>) {
  const { t } = useTranslation(["library"]);
  const opening = useOpenFolderFlowStore((state) => state.opening);
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="grid w-full gap-3 sm:grid-cols-2">
        <ChoiceCard
          testId="create-first-project"
          tour="new-project"
          image="/project-kind/new-project-light.webp"
          title={t(($) => $.library.start.newProjectTitle)}
          description={t(($) => $.library.start.newProjectDescription)}
          onClick={onNewProject}
        />
        <ChoiceCard
          testId="open-first-folder"
          disabled={opening}
          busy={opening}
          image="/project-kind/open-folder-light.webp"
          title={t(($) => $.library.start.openFolderTitle)}
          description={t(($) => $.library.start.openFolderDescription)}
          onClick={() => void openFolderWithPicker()}
        />
      </div>
      <OpenFolderNotice />
    </div>
  );
}

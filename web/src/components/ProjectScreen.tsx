import { setEditorTranslator } from "@oleafly/editor";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadingState } from "@/components/ui/empty";
import { socketUrl, type WebApi, type WebMe } from "../api";
import { ProjectController } from "../controller";
import { editorMessage, installPackageMessages } from "../i18n/packages";
import { mergePeople, resetWebState } from "../store";
import { ProjectView } from "./ProjectView";

installPackageMessages();
setEditorTranslator(editorMessage);

export default function ProjectScreen({
  api,
  me,
  projectId,
  onSignOut,
  signOutFailed,
}: Readonly<{ api: WebApi; me: WebMe; projectId: string; onSignOut: () => void; signOutFailed: boolean }>) {
  const { t } = useTranslation(["web"]);
  const [controller, setController] = useState<ProjectController | null>(null);

  useEffect(() => {
    resetWebState({ me, projectId, people: mergePeople({}, [me]) });
    const next = new ProjectController(projectId, { api, socketUrl: socketUrl(projectId) });
    setController(next);
    void next.start();
    return () => {
      next.stop();
    };
  }, [api, me, projectId]);

  if (!controller) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <LoadingState label={t(($) => $.web.app.loading)} />
      </div>
    );
  }
  return <ProjectView controller={controller} api={api} me={me} onSignOut={onSignOut} signOutFailed={signOutFailed} />;
}

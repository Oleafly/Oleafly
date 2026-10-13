import type { OverleafToolOutcome, OverleafToolProject } from "@oleafly/ai-tools";
import { i18n } from "@/i18n";
import { isOverleafError, overleafListProjects, overleafSignIn, overleafStatus } from "@/lib/overleaf";
import { useFilesStore } from "@/store/files";
import { useOverleafImportStore } from "@/store/overleaf-import";

async function signedInServer(): Promise<string> {
  const server = useOverleafImportStore.getState().server;
  const status = await overleafStatus(server);
  if (status.signedIn) return status.server;
  const signedIn = await overleafSignIn(server, i18n.t(($) => $.library.import.overleaf.signInWindowTitle));
  useOverleafImportStore.setState({ status: signedIn });
  return signedIn.server;
}

export async function listProjects(): Promise<{
  email: string | null;
  server: string;
  projects: OverleafToolProject[];
}> {
  const server = await signedInServer();
  try {
    const listed = await overleafListProjects(server);
    return { email: listed.status.email, server: listed.status.server, projects: listed.projects };
  } catch (error) {
    if (!isOverleafError(error, "session_expired")) throw error;
    const again = await signedInServer();
    const listed = await overleafListProjects(again);
    return { email: listed.status.email, server: listed.status.server, projects: listed.projects };
  }
}

export async function importProjects(ids: string[]): Promise<OverleafToolOutcome[]> {
  await signedInServer();
  const outcomes = await useOverleafImportStore.getState().importSelected(ids);
  if (outcomes.some((outcome) => outcome.projectId)) {
    await useFilesStore.getState().refreshProjects();
  }
  return outcomes;
}

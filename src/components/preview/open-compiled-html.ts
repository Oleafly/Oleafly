import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { openCompiledHtml } from "@/lib/notebook-commands";
import { toast } from "@/lib/toast";

export async function openHtmlInBrowser(projectId: string): Promise<void> {
  try {
    await openCompiledHtml(projectId);
  } catch (error) {
    void logError("open compiled HTML", error);
    toast.errorUnique(`open-html:${projectId}`, describeError(error));
  }
}

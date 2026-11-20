import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PreviewFrame } from "@/components/preview/PreviewFrame";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { useAsyncTask } from "@/hooks/use-async-task";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { basename } from "@/lib/path-utils";
import { projectHtmlPreviewUrl } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

export function HtmlFilePreview({ projectId, path }: Readonly<{ projectId: string; path: string }>) {
  return <HtmlPage key={`${projectId}\n${path}`} projectId={projectId} path={path} />;
}

function HtmlPage({ projectId, path }: Readonly<{ projectId: string; path: string }>) {
  const { t } = useTranslation(["common", "editor"]);
  const page = useAsyncTask<string>((error) => {
    void logError("preview an HTML file", error);
    return t(($) => $.editor.shell.htmlPreviewFailed, { detail: describeError(error) });
  });
  const { run } = page;
  const saved = useFilesStore((state) => {
    const file = state.files[path];
    return file && !file.dirty ? file.content : undefined;
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void run(() => projectHtmlPreviewUrl(projectId, path));
  }, [path, projectId, run]);

  useEffect(() => {
    if (saved !== undefined) setVersion((current) => current + 1);
  }, [saved]);

  if (page.error !== null) return <ErrorState className="p-6" message={page.error} />;
  if (page.result === null) return <LoadingState className="p-6" label={t(($) => $.common.state.loading)} />;
  return <PreviewFrame src={`${page.result}?v=${version}`} title={basename(path)} />;
}

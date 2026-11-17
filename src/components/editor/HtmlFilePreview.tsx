import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PreviewFrame } from "@/components/preview/PreviewFrame";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { basename } from "@/lib/path-utils";
import { projectHtmlPreviewUrl } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

type Page = { key: string } & ({ url: string } | { error: string });

export function HtmlFilePreview({ projectId, path }: Readonly<{ projectId: string; path: string }>) {
  const { t } = useTranslation(["common", "editor"]);
  const key = `${projectId}\n${path}`;
  const [page, setPage] = useState<Page | null>(null);
  const saved = useFilesStore((state) => {
    const file = state.files[path];
    return file && !file.dirty ? file.content : undefined;
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    projectHtmlPreviewUrl(projectId, path).then(
      (url) => {
        if (live) setPage({ key, url });
      },
      (error: unknown) => {
        void logError("preview an HTML file", error);
        if (live) setPage({ key, error: describeError(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [key, path, projectId]);

  useEffect(() => {
    if (saved !== undefined) setVersion((current) => current + 1);
  }, [saved]);

  const shown = page?.key === key ? page : null;
  if (!shown) return <div className="p-6 text-sm text-muted-foreground">{t(($) => $.common.state.loading)}</div>;
  if ("error" in shown) {
    return (
      <div className="p-6 text-sm text-destructive">
        {t(($) => $.editor.shell.htmlPreviewFailed, { detail: shown.error })}
      </div>
    );
  }
  return <PreviewFrame src={`${shown.url}?v=${version}`} title={basename(path)} />;
}

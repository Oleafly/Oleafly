import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";

const MAX_SHOWN = 12;

export function FileList({ files }: Readonly<{ files: readonly string[] }>) {
  const { t } = useTranslation(["shell"]);
  const shown = files.slice(0, MAX_SHOWN);
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 font-mono text-xs">
      {shown.map((file) => (
        <li key={file} className="truncate">
          <Tooltip label={file} wide className="max-w-full">
            <span className="block truncate">{file}</span>
          </Tooltip>
        </li>
      ))}
      {files.length > shown.length ? (
        <li className="font-sans text-muted-foreground">
          {t(($) => $.shell.overleafSync.more, { count: files.length - shown.length })}
        </li>
      ) : null}
    </ul>
  );
}

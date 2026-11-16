import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseDelimited } from "@oleafly/conversion-registry/table";
import { BlockFileTooLargeError } from "@/components/notes/note-blocks";
import { problemText, TableView, tableErrorText } from "@/components/notes/table-block";
import {
  buildTable,
  readSpreadsheetRows,
  TABLE_MAX_BYTES,
  TABLE_MAX_ROWS,
  type TableResult,
  tableDelimiter,
} from "@/components/notes/table-data";
import { base64ToUint8Array, readFileBase64 } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

type Loaded = { key: string } & ({ result: TableResult } | { error: string });

function SheetResult({ result }: Readonly<{ result: TableResult }>) {
  if (!result.ok) return <p className="p-6 text-sm text-muted-foreground">{problemText(result.problem)}</p>;
  return (
    <div className="h-full p-3">
      <TableView table={result.table} fill />
    </div>
  );
}

function TextSheet({ path }: Readonly<{ path: string }>) {
  const content = useFilesStore((state) => state.files[path]?.content);
  const result = useMemo(() => {
    if (content === undefined) return null;
    const delimiter = tableDelimiter(/\.tsv$/iu.test(path) ? "tsv" : "csv", content);
    return buildTable(parseDelimited(content, { delimiter, limit: TABLE_MAX_ROWS + 2, trim: false }));
  }, [content, path]);
  return result ? <SheetResult result={result} /> : null;
}

function WorkbookSheet({ projectId, path }: Readonly<{ projectId: string; path: string }>) {
  const { t } = useTranslation(["common"]);
  const key = `${projectId}\n${path}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    const source = { kind: "file", path, format: "spreadsheet", sheet: null, thousands: false } as const;
    const read = async (): Promise<TableResult> => {
      const bytes = base64ToUint8Array(await readFileBase64(projectId, path));
      if (bytes.length > TABLE_MAX_BYTES) throw new BlockFileTooLargeError();
      return buildTable(await readSpreadsheetRows(bytes, null));
    };
    read().then(
      (result) => {
        if (live) setLoaded({ key, result });
      },
      (error: unknown) => {
        if (live) setLoaded({ key, error: tableErrorText(error, source) });
      },
    );
    return () => {
      live = false;
    };
  }, [key, path, projectId]);
  const shown = loaded?.key === key ? loaded : null;
  if (!shown) return <div className="p-6 text-sm text-muted-foreground">{t(($) => $.common.state.loading)}</div>;
  if ("error" in shown) return <p className="p-6 text-sm text-destructive">{shown.error}</p>;
  return <SheetResult result={shown.result} />;
}

export function SheetFilePreview({
  projectId,
  path,
  workbook = false,
}: Readonly<{ projectId: string; path: string; workbook?: boolean }>) {
  return workbook ? <WorkbookSheet projectId={projectId} path={path} /> : <TextSheet path={path} />;
}

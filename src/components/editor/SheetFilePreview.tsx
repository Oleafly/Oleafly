import { useDeferredValue, useEffect, useMemo } from "react";
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
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { useAsyncTask } from "@/hooks/use-async-task";
import { logError } from "@/lib/log";
import { projectFileSizes, readProjectBytes } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";

function overTableLimit(text: string): boolean {
  if (text.length > TABLE_MAX_BYTES) return true;
  return text.length * 3 > TABLE_MAX_BYTES && new TextEncoder().encode(text).length > TABLE_MAX_BYTES;
}

async function readWorkbook(projectId: string, path: string): Promise<TableResult> {
  const size = (await projectFileSizes(projectId, [path]))[path];
  if (size !== undefined && size > TABLE_MAX_BYTES) throw new BlockFileTooLargeError();
  const bytes = new Uint8Array(await readProjectBytes(projectId, path));
  if (bytes.length > TABLE_MAX_BYTES) throw new BlockFileTooLargeError();
  return buildTable(await readSpreadsheetRows(bytes, null));
}

function SheetResult({ result }: Readonly<{ result: TableResult }>) {
  if (!result.ok) return <p className="p-6 text-sm text-muted-foreground">{problemText(result.problem)}</p>;
  return (
    <div className="h-full p-3">
      <TableView table={result.table} fill />
    </div>
  );
}

function TextSheet({ path }: Readonly<{ path: string }>) {
  const { t } = useTranslation(["notes"]);
  const content = useDeferredValue(useFilesStore((state) => state.files[path]?.content));
  const result = useMemo(() => {
    if (content === undefined || overTableLimit(content)) return null;
    const delimiter = tableDelimiter(/\.tsv$/iu.test(path) ? "tsv" : "csv", content);
    return buildTable(parseDelimited(content, { delimiter, limit: TABLE_MAX_ROWS + 2, trim: false }));
  }, [content, path]);
  if (content !== undefined && !result) return <ErrorState className="p-6" message={t(($) => $.notes.blocks.table.tooLarge)} />;
  return result ? <SheetResult result={result} /> : null;
}

function WorkbookSheet({ projectId, path }: Readonly<{ projectId: string; path: string }>) {
  const { t } = useTranslation(["common"]);
  const workbook = useAsyncTask<TableResult>((error) => {
    if (!(error instanceof BlockFileTooLargeError)) void logError("open a spreadsheet", error);
    return tableErrorText(error, { kind: "file", path, format: "spreadsheet", sheet: null, thousands: false });
  });
  const { run } = workbook;
  useEffect(() => {
    void run(() => readWorkbook(projectId, path));
  }, [path, projectId, run]);
  if (workbook.error !== null) return <ErrorState className="p-6" message={workbook.error} />;
  if (!workbook.result) return <LoadingState className="p-6" label={t(($) => $.common.state.loading)} />;
  return <SheetResult result={workbook.result} />;
}

export function SheetFilePreview({
  projectId,
  path,
  workbook = false,
}: Readonly<{ projectId: string; path: string; workbook?: boolean }>) {
  const key = `${projectId}\n${path}`;
  return workbook ? <WorkbookSheet key={key} projectId={projectId} path={path} /> : <TextSheet key={key} path={path} />;
}

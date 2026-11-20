import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { decodeAppError } from "@/lib/app-error";
import { diskHash } from "@/lib/disk-hash";
import { logError } from "@/lib/log";
import { deleteAskingWithoutTrash } from "@/lib/project-file-delete";
import { deleteFile, existingProjectFiles, readFileContent } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { VersionPickDialog } from "./VersionPickDialog";

export interface ConflictCopy {
  projectId: string;
  title: string;
  mainDoc: string;
  copies: readonly string[];
}

interface Versions {
  copy: string;
  mine: string;
  theirs: string;
}

export default function ConflictCopyDialog({ conflict, onClose }: Readonly<{ conflict: ConflictCopy; onClose: () => void }>) {
  const { t } = useTranslation(["cloud", "common"]);
  const { projectId, mainDoc, copies } = conflict;
  const [remaining, setRemaining] = useState<readonly string[] | null>(null);
  const [versions, setVersions] = useState<Versions | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = remaining?.[0] ?? null;
  const current = versions !== null && versions !== "failed" && versions.copy !== copy ? null : versions;

  useEffect(() => {
    let live = true;
    existingProjectFiles(projectId, [...copies]).then(
      (found) => {
        if (live) setRemaining(copies.filter((path) => found.includes(path)));
      },
      (error: unknown) => {
        void logError("check conflict copies", error);
        if (live) setRemaining([...copies]);
      },
    );
    return () => {
      live = false;
    };
  }, [copies, projectId]);

  useEffect(() => {
    if (remaining === null || remaining.length > 0) return;
    void useCloudStore.getState().dismissConflicts(projectId);
    onClose();
  }, [onClose, projectId, remaining]);

  const readVersions = useCallback(
    (path: string, live: () => boolean) => {
      setVersions(null);
      Promise.all([readFileContent(projectId, mainDoc), readFileContent(projectId, path)]).then(
        ([mine, theirs]) => {
          if (live()) setVersions({ copy: path, mine, theirs });
        },
        (error: unknown) => {
          void logError("read a conflict copy", error);
          if (live()) setVersions("failed");
        },
      );
    },
    [mainDoc, projectId],
  );

  useEffect(() => {
    if (copy === null) return;
    let live = true;
    readVersions(copy, () => live);
    return () => {
      live = false;
    };
  }, [copy, readVersions]);

  const keep = async (theirs: boolean) => {
    if (current === null || current === "failed" || busy) return;
    setBusy(true);
    try {
      if (theirs) {
        const { writeProjectFile } = useFilesStore.getState();
        const { recordNoteWrite } = await import("@/components/notes/notes-service");
        await recordNoteWrite(projectId, current.theirs, () =>
          writeProjectFile(projectId, mainDoc, current.theirs, {
            closedProject: true,
            crlf: current.theirs.includes("\r\n"),
            expectedHash: diskHash(current.mine),
          }),
        );
        await writeProjectFile(projectId, current.copy, current.mine, { closedProject: true, crlf: current.mine.includes("\r\n") });
      }
      const removed = await deleteAskingWithoutTrash(
        current.copy,
        () => deleteFile(projectId, current.copy, undefined, false),
        () => deleteFile(projectId, current.copy, undefined, true),
      );
      if (removed) {
        setRemaining((list) => (list ?? []).filter((path) => path !== current.copy));
      } else {
        readVersions(current.copy, () => true);
      }
    } catch (error) {
      notifyError(
        "resolve a conflict copy",
        error,
        decodeAppError(error) ? undefined : t(($) => $.cloud.conflictCopy.resolveFailed),
      );
      readVersions(current.copy, () => true);
    } finally {
      setBusy(false);
    }
  };

  const ready = current !== null && current !== "failed" && !busy;
  const body = () => {
    if (current === "failed") {
      return <p className="p-3 text-xs text-destructive">{t(($) => $.cloud.conflictCopy.readFailed)}</p>;
    }
    if (current === null) {
      return (
        <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Spinner size="sm" />
          {t(($) => $.cloud.conflictCopy.loading)}
        </p>
      );
    }
    return (
      <InlineDiffPreview
        path={mainDoc}
        oldText={current.mine}
        newText={current.theirs}
        ariaLabel={t(($) => $.cloud.conflictCopy.diffLabel)}
        className="h-full"
      />
    );
  };

  return (
    <VersionPickDialog
      title={t(($) => $.cloud.conflictCopy.title, { name: conflict.title })}
      description={t(($) => $.cloud.conflictCopy.description)}
      detail={copy !== null && <p className="select-text break-all font-mono text-[0.6875rem] text-muted-foreground">{copy}</p>}
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={() => void keep(false)}>
            {t(($) => $.cloud.conflictCopy.keepMine)}
          </Button>
          <Button type="button" size="sm" disabled={!ready} onClick={() => void keep(true)}>
            {t(($) => $.cloud.conflictCopy.useCopy)}
          </Button>
        </>
      }
    >
      {body()}
    </VersionPickDialog>
  );
}

import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { Spinner } from "@/components/ui/spinner";
import { logError } from "@/lib/log";
import { deleteFile, existingProjectFiles, readFileContent } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";

export interface NoteConflict {
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

export default function NoteConflictDialog({ conflict, onClose }: Readonly<{ conflict: NoteConflict; onClose: () => void }>) {
  const { t } = useTranslation(["notes", "common"]);
  const { projectId, mainDoc, copies } = conflict;
  const titleId = useId();
  const descriptionId = useId();
  const [remaining, setRemaining] = useState<readonly string[] | null>(null);
  const [versions, setVersions] = useState<Versions | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = remaining?.[0] ?? null;

  useEffect(() => {
    let live = true;
    existingProjectFiles(projectId, [...copies]).then(
      (found) => {
        if (live) setRemaining(copies.filter((path) => found.includes(path)));
      },
      (error: unknown) => {
        void logError("check note conflict copies", error);
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

  useEffect(() => {
    if (copy === null) return;
    let live = true;
    setVersions(null);
    Promise.all([readFileContent(projectId, mainDoc), readFileContent(projectId, copy)]).then(
      ([mine, theirs]) => {
        if (live) setVersions({ copy, mine, theirs });
      },
      (error: unknown) => {
        void logError("read a note conflict copy", error);
        if (live) setVersions("failed");
      },
    );
    return () => {
      live = false;
    };
  }, [copy, mainDoc, projectId]);

  const keep = async (theirs: boolean) => {
    if (versions === null || versions === "failed" || busy) return;
    setBusy(true);
    try {
      if (theirs) {
        const { writeProjectFile } = useFilesStore.getState();
        await writeProjectFile(projectId, versions.copy, versions.mine, { closedProject: true, crlf: versions.mine.includes("\r\n") });
        await writeProjectFile(projectId, mainDoc, versions.theirs, { closedProject: true, crlf: versions.theirs.includes("\r\n") });
      }
      await deleteFile(projectId, versions.copy);
      setRemaining((list) => (list ?? []).filter((path) => path !== versions.copy));
    } catch (error) {
      notifyError("resolve a note conflict copy", error, t(($) => $.notes.library.conflicts.resolveFailed));
    } finally {
      setBusy(false);
    }
  };

  const ready = versions !== null && versions !== "failed" && !busy;
  const body = () => {
    if (versions === "failed") {
      return <p className="p-3 text-xs text-destructive">{t(($) => $.notes.library.conflicts.readFailed)}</p>;
    }
    if (versions === null) {
      return (
        <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Spinner size="sm" />
          {t(($) => $.notes.library.conflicts.loading)}
        </p>
      );
    }
    return (
      <InlineDiffPreview
        path={mainDoc}
        oldText={versions.mine}
        newText={versions.theirs}
        ariaLabel={t(($) => $.notes.library.conflicts.diffLabel)}
        className="h-full"
      />
    );
  };

  return (
    <ModalShell
      open
      portal
      onClose={onClose}
      closeLabel={t(($) => $.common.actions.close)}
      width="2xl"
      labelledBy={titleId}
      describedBy={descriptionId}
      className="flex max-h-[85vh] flex-col gap-3 p-5"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t(($) => $.notes.library.conflicts.title, { name: conflict.title })}
      </h2>
      <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
        {t(($) => $.notes.library.conflicts.description)}
      </p>
      {copy !== null && <p className="select-text break-all font-mono text-[0.6875rem] text-muted-foreground">{copy}</p>}
      <div data-conflict-diff className="h-80 min-h-0 overflow-hidden rounded-md border">
        {body()}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} data-modal-initial-focus>
          {t(($) => $.common.actions.close)}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={() => void keep(false)}>
          {t(($) => $.notes.library.conflicts.keepMine)}
        </Button>
        <Button type="button" size="sm" disabled={!ready} onClick={() => void keep(true)}>
          {t(($) => $.notes.library.conflicts.useCopy)}
        </Button>
      </div>
    </ModalShell>
  );
}

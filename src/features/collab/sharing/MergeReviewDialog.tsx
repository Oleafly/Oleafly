import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { DiffPreview } from "@/components/ai/turns/DiffPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import { collabMergeReview, type CollabMergeReviewFile } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { InlineAlert } from "../feedback";
import type { MergedFileCount } from "./activity-store";

export interface MergeReviewEntry {
  files: readonly MergedFileCount[];
  authors?: readonly { accountId: string; files: readonly MergedFileCount[] }[];
  review?: { before: string; after: string };
}

type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; files: CollabMergeReviewFile[] };

function total(files: readonly MergedFileCount[]): number {
  return files.reduce((sum, file) => sum + file.changes, 0);
}

export function MergeReviewDialog({
  projectId,
  entry,
  onClose,
}: Readonly<{ projectId: string; entry: MergeReviewEntry; onClose: () => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const titleId = useId();
  const peopleId = useId();
  const filesId = useId();
  const members = useCollabLiveStore((state) => state.members);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const before = entry.review?.before ?? "";
  const after = entry.review?.after ?? "";

  useEffect(() => {
    let current = true;
    setLoaded({ state: "loading" });
    collabMergeReview(projectId, before, after).then(
      (files) => {
        if (current) setLoaded({ state: "ready", files });
      },
      (error: unknown) => {
        void logError("collab merge review", error);
        if (current) setLoaded({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, before, after]);

  const nameOf = (accountId: string) =>
    members.find((member) => member.person.account_id === accountId)?.person.display_name ??
    t(($) => $.collab.toolbar.unknownPerson);
  const changesIn = (path: string) => entry.files.find((file) => file.path === path)?.changes ?? 0;
  const close = t(($) => $.common.actions.close);

  return (
    <ModalShell
      open
      portal
      onClose={onClose}
      closeLabel={close}
      width="2xl"
      labelledBy={titleId}
      className="flex max-h-[85vh] flex-col gap-4 p-5"
      testId="collab-merge-review"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-base font-semibold">
            {t(($) => $.collab.mergeReview.title)}
          </h2>
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.mergeReview.description)}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={close}
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {entry.authors && entry.authors.length > 0 ? (
          <section className="space-y-1.5">
            <h3 id={peopleId} className="text-xs font-medium text-muted-foreground">
              {t(($) => $.collab.mergeReview.people)}
            </h3>
            <ul aria-labelledby={peopleId} className="space-y-1.5 text-xs">
              {entry.authors.map((author) => (
                <li key={author.accountId} className="space-y-0.5">
                  <p className="font-medium">
                    {t(($) => $.collab.mergeReview.person, {
                      name: nameOf(author.accountId),
                      number: formatNumber(total(author.files)),
                    })}
                  </p>
                  <ul className="space-y-0.5 pl-3 font-mono text-muted-foreground">
                    {author.files.map((file) => (
                      <li key={file.path} className="truncate">
                        {t(($) => $.collab.activity.mergedFile, {
                          path: file.path,
                          number: formatNumber(file.changes),
                        })}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="space-y-1.5">
          <h3 id={filesId} className="text-xs font-medium text-muted-foreground">
            {t(($) => $.collab.mergeReview.files)}
          </h3>
          {loaded.state === "loading" ? (
            <p className="text-xs text-muted-foreground">{t(($) => $.collab.mergeReview.loading)}</p>
          ) : null}
          {loaded.state === "failed" ? <InlineAlert>{t(($) => $.collab.mergeReview.failed)}</InlineAlert> : null}
          {loaded.state === "ready" && loaded.files.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t(($) => $.collab.mergeReview.noText)}</p>
          ) : null}
          {loaded.state === "ready" && loaded.files.length > 0 ? (
            <ul aria-labelledby={filesId} className="space-y-3">
              {loaded.files.map((file) => (
                <li key={file.path} className="space-y-1.5">
                  <p className="flex min-w-0 items-center gap-2 text-xs">
                    <span className="truncate font-mono">
                      {t(($) => $.collab.activity.mergedFile, {
                        path: file.path,
                        number: formatNumber(changesIn(file.path)),
                      })}
                    </span>
                    {file.before === null ? (
                      <Badge variant="primaryGhost" size="sm">
                        {t(($) => $.collab.mergeReview.newFile)}
                      </Badge>
                    ) : null}
                    {file.after === null ? (
                      <Badge variant="primaryGhost" size="sm">
                        {t(($) => $.collab.mergeReview.removedFile)}
                      </Badge>
                    ) : null}
                  </p>
                  <DiffPreview
                    path={file.path}
                    oldText={file.before ?? ""}
                    newText={file.after ?? ""}
                    label={t(($) => $.collab.mergeReview.diffLabel, { path: file.path })}
                    loadingLabel={t(($) => $.collab.mergeReview.loading)}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </ModalShell>
  );
}

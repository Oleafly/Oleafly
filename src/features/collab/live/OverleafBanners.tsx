import { CloudDownload, FolderX, GitMerge, LogOut, Settings2, TriangleAlert, Unplug, UserRoundCog, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { VersionPickDialog } from "@/components/cloud/VersionPickDialog";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Progress } from "@/components/ui/progress";
import { WorkspaceBanner, WorkspaceBannerAlert, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { useNow } from "@/hooks/use-now";
import { decodeXmlEntities, stripTags } from "@/lib/citation/text";
import { logError } from "@/lib/log";
import { overleafLiveProject, serverHost } from "@/lib/overleaf-live";
import { recycleProject } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "./live-store";
import { NoticeGroup } from "./NoticeGroup";
import { OverleafDeleteDialog } from "./OverleafDeleteDialog";
import { type OverleafMerge, type OverleafReview, useOverleafNotices } from "./overleaf-notices";

type Shown = { kind: "merged"; entry: OverleafMerge } | { kind: "review"; entry: OverleafReview };

function SignedOutBanner() {
  const { t } = useTranslation(["collab"]);
  const signedOut = useCollabLiveStore((state) => state.status?.state === "signed_out");
  const server = useCollabLiveStore((state) => state.overleaf?.server ?? null);
  const email = useCollabLiveStore((state) => state.overleaf?.account?.email ?? null);
  if (!signedOut || !server) return null;
  const host = serverHost(server);
  return (
    <WorkspaceBanner tone="warning" data-testid="overleaf-signed-out-banner">
      <LogOut aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">
        {email
          ? t(($) => $.collab.overleafBanners.signedOutAs, { email, server: host })
          : t(($) => $.collab.overleafBanners.signedOut, { server: host })}
      </p>
      <WorkspaceBannerButton tone="warning" onClick={() => useSettingsStore.getState().openSettingsAt("integrations")}>
        {email ? t(($) => $.collab.overleafBanners.signInAs, { email }) : t(($) => $.collab.activity.signIn)}
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}

function AccountChangedBanner() {
  const { t } = useTranslation(["collab"]);
  const changed = useCollabLiveStore((state) => state.accountChanged);
  const dismiss = useCollabLiveStore((state) => state.dismissAccountChanged);
  if (!changed || changed.files.length === 0) return null;
  const { files } = changed;
  const email = changed.typedAs.email;
  const listed = files.length > 1;
  const message = listed
    ? t(($) => $.collab.overleafBanners.accountChangedMany, { email })
    : t(($) => $.collab.overleafBanners.accountChangedOne, { email, copy: files[0].copy });
  return (
    <WorkspaceBanner tone="primary" data-testid="overleaf-account-changed-banner">
      <UserRoundCog aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 select-text">{message}</p>
      <WorkspaceBannerButton tone="primary" onClick={dismiss}>
        {t(($) => $.collab.files.dismiss)}
      </WorkspaceBannerButton>
      {listed ? (
        <ul className="max-h-48 basis-full space-y-0.5 overflow-y-auto pb-1 select-text">
          {files.map((file) => (
            <li key={file.id} className="truncate">
              {t(($) => $.collab.overleafBanners.keptAs, { file: file.path, copy: file.copy })}
            </li>
          ))}
        </ul>
      ) : null}
    </WorkspaceBanner>
  );
}

type Maintenance = NonNullable<ReturnType<typeof useOverleafNotices.getState>["maintenance"]>;

function MaintenanceCountdown({ maintenance }: Readonly<{ maintenance: Maintenance }>) {
  const { t } = useTranslation(["collab"]);
  const now = useNow(1_000);
  const seconds = Math.max(0, Math.ceil((maintenance.until - now) / 1_000));
  const message = decodeXmlEntities(stripTags(maintenance.message));
  return (
    <WorkspaceBanner tone="warning" data-testid="overleaf-maintenance-banner">
      <Wrench aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1 select-text">
        {t(($) => $.collab.overleafBanners.maintenance, { message })}{" "}
        {seconds > 0
          ? t(($) => $.collab.overleafBanners.maintenanceWait, { seconds })
          : t(($) => $.collab.overleafBanners.reconnecting)}
      </p>
    </WorkspaceBanner>
  );
}

function MaintenanceBanner() {
  const maintenance = useOverleafNotices((state) => state.maintenance);
  return maintenance ? <MaintenanceCountdown maintenance={maintenance} /> : null;
}

function MergedRows({ onShow }: Readonly<{ onShow: (shown: Shown) => void }>) {
  const { t } = useTranslation(["collab"]);
  const merged = useOverleafNotices((state) => state.merged);
  const dismiss = useOverleafNotices((state) => state.dismissMerged);
  if (merged.length === 0) return null;
  const dismissLabel = t(($) => $.collab.files.dismiss);
  return (
    <NoticeGroup
      tone="primary"
      testId="overleaf-merged-row"
      icon={<GitMerge aria-hidden className="size-3.5 shrink-0 text-primary" />}
      message={(path) => t(($) => $.collab.overleafBanners.merged, { path })}
      actions={
        <WorkspaceBannerButton
          tone="primary"
          onClick={() => {
            for (const entry of merged) dismiss(entry.path);
          }}
        >
          {dismissLabel}
        </WorkspaceBannerButton>
      }
      items={merged.map((entry) => ({
        key: entry.path,
        path: entry.path,
        name: entry.path,
        actions: (
          <>
            <WorkspaceBannerButton tone="primary" onClick={() => onShow({ kind: "merged", entry })}>
              {t(($) => $.collab.overleafBanners.showChanges)}
            </WorkspaceBannerButton>
            <WorkspaceBannerButton tone="primary" onClick={() => dismiss(entry.path)}>
              {dismissLabel}
            </WorkspaceBannerButton>
          </>
        ),
      }))}
    />
  );
}

function ReviewRows({ onShow }: Readonly<{ onShow: (shown: Shown) => void }>) {
  const { t } = useTranslation(["collab"]);
  const reviews = useOverleafNotices((state) => state.reviews);
  const resolving = useOverleafNotices((state) => state.resolving);
  const failed = useOverleafNotices((state) => state.failed);
  const resolve = useOverleafNotices((state) => state.resolve);
  return (
    <NoticeGroup
      tone="warning"
      testId="overleaf-review-row"
      icon={<TriangleAlert aria-hidden className="size-3.5 shrink-0" />}
      message={(path) => t(($) => $.collab.overleafBanners.review, { path })}
      items={reviews.map((entry) => ({
        key: entry.path,
        path: entry.path,
        name: entry.path,
        actions: (
          <>
            <WorkspaceBannerButton tone="warning" onClick={() => onShow({ kind: "review", entry })}>
              {t(($) => $.collab.overleafBanners.compare)}
            </WorkspaceBannerButton>
            <WorkspaceBannerButton
              tone="warning"
              disabled={resolving !== null}
              onClick={() => void resolve(entry.path, "theirs")}
            >
              {t(($) => $.collab.overleafBanners.useTheirs)}
            </WorkspaceBannerButton>
          </>
        ),
        alert:
          failed === entry.path ? (
            <WorkspaceBannerAlert>{t(($) => $.collab.overleafBanners.resolveFailed)}</WorkspaceBannerAlert>
          ) : null,
      }))}
    />
  );
}

function UnsteadyRows() {
  const { t } = useTranslation(["collab"]);
  const unsteady = useOverleafNotices((state) => state.unsteady);
  const dismiss = useOverleafNotices((state) => state.dismissUnsteady);
  if (unsteady.length === 0) return null;
  const dismissLabel = t(($) => $.collab.files.dismiss);
  return (
    <NoticeGroup
      tone="warning"
      testId="overleaf-unsteady-row"
      icon={<Unplug aria-hidden className="size-3.5 shrink-0" />}
      message={(path) => t(($) => $.collab.overleafBanners.unsteady, { path })}
      actions={
        <WorkspaceBannerButton
          tone="warning"
          onClick={() => {
            for (const path of unsteady) dismiss(path);
          }}
        >
          {dismissLabel}
        </WorkspaceBannerButton>
      }
      items={unsteady.map((path) => ({
        key: path,
        path,
        name: path,
        actions: (
          <WorkspaceBannerButton tone="warning" onClick={() => dismiss(path)}>
            {dismissLabel}
          </WorkspaceBannerButton>
        ),
      }))}
    />
  );
}

function FillingBanner() {
  const { t } = useTranslation(["collab"]);
  const filling = useOverleafNotices((state) => state.filling);
  if (!filling) return null;
  const { done, total } = filling;
  const percent = total > 0 ? Math.round((done / total) * 100) : 100;
  return (
    <WorkspaceBanner tone="primary" data-testid="overleaf-filling-banner">
      <CloudDownload aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">
        {done < total
          ? t(($) => $.collab.overleafBanners.filling, { done, total })
          : t(($) => $.collab.overleafBanners.fillingFiles)}
      </p>
      <Progress value={percent} className="h-1 w-24" />
    </WorkspaceBanner>
  );
}

const GONE = new Set(["project_deleted", "access_ended", "removed"]);

async function removeEmptyCopy(projectId: string): Promise<boolean> {
  const fresh = await overleafLiveProject(projectId);
  if (!fresh?.unfilled) return false;
  const files = useFilesStore.getState();
  await files.closeProject();
  await recycleProject(projectId);
  await files.refreshProjects();
  return true;
}

function EmptyCopyBanner() {
  const { t } = useTranslation(["collab"]);
  const projectId = useCollabLiveStore((state) => state.projectId);
  const gone = useCollabLiveStore(
    (state) => state.status?.state === "ended" && GONE.has(state.status.reason),
  );
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setEmpty(false);
    if (!gone || !projectId) return;
    let cancelled = false;
    overleafLiveProject(projectId).then(
      (project) => {
        if (!cancelled) setEmpty(project?.unfilled === true);
      },
      (error: unknown) => void logError("read the overleaf live project", error),
    );
    return () => {
      cancelled = true;
    };
  }, [gone, projectId]);
  if (!gone || !empty || !projectId) return null;
  const remove = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (!(await removeEmptyCopy(projectId))) setEmpty(false);
    } catch (error) {
      void logError("remove an empty overleaf copy", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <WorkspaceBanner tone="warning" data-testid="overleaf-empty-copy-banner">
      <FolderX aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{t(($) => $.collab.overleafBanners.emptyCopy)}</p>
      <WorkspaceBannerButton tone="warning" disabled={busy} onClick={() => void remove()}>
        {t(($) => $.collab.overleafBanners.removeEmptyCopy)}
      </WorkspaceBannerButton>
      {failed ? <WorkspaceBannerAlert>{t(($) => $.collab.overleafBanners.removeFailed)}</WorkspaceBannerAlert> : null}
    </WorkspaceBanner>
  );
}

function SettingsBanner() {
  const { t } = useTranslation(["collab"]);
  const settings = useOverleafNotices((state) => state.settings);
  const dismiss = useOverleafNotices((state) => state.dismissSettings);
  if (settings.length === 0) return null;
  return (
    <WorkspaceBanner tone="warning" data-testid="overleaf-settings-banner">
      <Settings2 aria-hidden className="size-3.5 shrink-0" />
      <ul className="min-w-0 flex-1 space-y-0.5 select-text">
        {settings.map((entry) => (
          <li key={entry.setting}>
            {t(($) => $.collab.overleafBanners.settingNotSent[entry.reason], {
              setting: t(($) => $.collab.overleafBanners.settingNames[entry.setting]),
            })}
          </li>
        ))}
      </ul>
      <WorkspaceBannerButton tone="warning" onClick={dismiss}>
        {t(($) => $.collab.files.dismiss)}
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}

function CompareDialog({ shown, onClose }: Readonly<{ shown: Shown; onClose: () => void }>) {
  const { t } = useTranslation(["collab"]);
  const resolve = useOverleafNotices((state) => state.resolve);
  const resolving = useOverleafNotices((state) => state.resolving);
  const failed = useOverleafNotices((state) => state.failed === shown.entry.path);
  const { path } = shown.entry;
  const merged = shown.kind === "merged";
  const [oldText, newText] = merged ? [shown.entry.before, shown.entry.after] : [shown.entry.mine, shown.entry.theirs];
  const keep = (choice: "mine" | "theirs") =>
    void resolve(path, choice).then((done) => {
      if (done) onClose();
    });
  return (
    <VersionPickDialog
      title={
        merged
          ? t(($) => $.collab.overleafBanners.mergedTitle, { path })
          : t(($) => $.collab.overleafBanners.reviewTitle, { path })
      }
      description={
        merged
          ? t(($) => $.collab.overleafBanners.mergedDescription)
          : t(($) => $.collab.overleafBanners.reviewDescription)
      }
      alert={failed ? <InlineAlert>{t(($) => $.collab.overleafBanners.resolveFailed)}</InlineAlert> : null}
      onClose={onClose}
      actions={
        merged ? null : (
          <>
            <Button type="button" variant="outline" size="sm" disabled={resolving !== null} onClick={() => keep("theirs")}>
              {t(($) => $.collab.overleafBanners.useTheirs)}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={resolving !== null} onClick={() => keep("mine")}>
              {t(($) => $.collab.overleafBanners.useMine)}
            </Button>
          </>
        )
      }
    >
      <InlineDiffPreview
        path={path}
        oldText={oldText}
        newText={newText}
        ariaLabel={t(($) => $.collab.overleafBanners.diffLabel)}
        className="h-full"
      />
    </VersionPickDialog>
  );
}

export function OverleafBanners() {
  const [shown, setShown] = useState<Shown | null>(null);
  return (
    <>
      <SignedOutBanner />
      <EmptyCopyBanner />
      <AccountChangedBanner />
      <FillingBanner />
      <MaintenanceBanner />
      <ReviewRows onShow={setShown} />
      <MergedRows onShow={setShown} />
      <UnsteadyRows />
      <SettingsBanner />
      {shown ? <CompareDialog shown={shown} onClose={() => setShown(null)} /> : null}
      <OverleafDeleteDialog />
    </>
  );
}

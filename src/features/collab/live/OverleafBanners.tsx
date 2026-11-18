import { GitMerge, LogOut, TriangleAlert, Unplug, UserRoundCog, Wrench } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import { serverHost } from "@/components/library/overleaf/OverleafServerField";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { useNow } from "@/hooks/use-now";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "./live-store";
import { OverleafDeleteDialog } from "./OverleafDeleteDialog";
import { type OverleafMerge, type OverleafReview, useOverleafNotices } from "./overleaf-notices";

type Shown = { kind: "merged"; entry: OverleafMerge } | { kind: "review"; entry: OverleafReview };

function SignedOutBanner() {
  const { t } = useTranslation(["collab"]);
  const signedOut = useCollabLiveStore((state) => state.status?.state === "signed_out");
  const server = useCollabLiveStore((state) => state.overleaf?.server ?? null);
  if (!signedOut || !server) return null;
  return (
    <WorkspaceBanner tone="warning" data-testid="overleaf-signed-out-banner">
      <LogOut aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{t(($) => $.collab.overleafBanners.signedOut, { server: serverHost(server) })}</p>
      <WorkspaceBannerButton tone="warning" onClick={() => useSettingsStore.getState().openSettingsAt("integrations")}>
        {t(($) => $.collab.activity.signIn)}
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
        <ul className="basis-full space-y-0.5 pb-1 select-text">
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

function MaintenanceBanner() {
  const { t } = useTranslation(["collab"]);
  const maintenance = useOverleafNotices((state) => state.maintenance);
  const now = useNow(1_000);
  if (!maintenance) return null;
  const seconds = Math.max(0, Math.ceil((maintenance.until - now) / 1_000));
  return (
    <WorkspaceBanner tone="warning" data-testid="overleaf-maintenance-banner">
      <Wrench aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1 select-text">
        {t(($) => $.collab.overleafBanners.maintenance, { message: maintenance.message })}{" "}
        {seconds > 0
          ? t(($) => $.collab.overleafBanners.maintenanceWait, { seconds })
          : t(($) => $.collab.overleafBanners.reconnecting)}
      </p>
    </WorkspaceBanner>
  );
}

function MergedRows({ onShow }: Readonly<{ onShow: (shown: Shown) => void }>) {
  const { t } = useTranslation(["collab"]);
  const merged = useOverleafNotices((state) => state.merged);
  const dismiss = useOverleafNotices((state) => state.dismissMerged);
  return merged.map((entry) => (
    <WorkspaceBanner key={entry.path} tone="primary" data-testid="overleaf-merged-row">
      <GitMerge aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 select-text">{t(($) => $.collab.overleafBanners.merged, { path: entry.path })}</p>
      <span className="flex shrink-0 items-center gap-1">
        <WorkspaceBannerButton tone="primary" onClick={() => onShow({ kind: "merged", entry })}>
          {t(($) => $.collab.overleafBanners.showChanges)}
        </WorkspaceBannerButton>
        <WorkspaceBannerButton tone="primary" onClick={() => dismiss(entry.path)}>
          {t(($) => $.collab.files.dismiss)}
        </WorkspaceBannerButton>
      </span>
    </WorkspaceBanner>
  ));
}

function ReviewRows({ onShow }: Readonly<{ onShow: (shown: Shown) => void }>) {
  const { t } = useTranslation(["collab"]);
  const reviews = useOverleafNotices((state) => state.reviews);
  const resolving = useOverleafNotices((state) => state.resolving);
  const failed = useOverleafNotices((state) => state.failed);
  const resolve = useOverleafNotices((state) => state.resolve);
  return reviews.map((entry) => (
    <WorkspaceBanner key={entry.path} tone="warning" data-testid="overleaf-review-row">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 select-text">
        <p>{t(($) => $.collab.overleafBanners.review, { path: entry.path })}</p>
        {failed === entry.path ? (
          <p role="alert" className="font-semibold">
            {t(($) => $.collab.overleafBanners.resolveFailed)}
          </p>
        ) : null}
      </div>
      <span className="flex shrink-0 items-center gap-1">
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
        <WorkspaceBannerButton
          tone="warning"
          disabled={resolving !== null}
          onClick={() => void resolve(entry.path, "mine")}
        >
          {t(($) => $.collab.overleafBanners.useMine)}
        </WorkspaceBannerButton>
      </span>
    </WorkspaceBanner>
  ));
}

function UnsteadyRows() {
  const { t } = useTranslation(["collab"]);
  const unsteady = useOverleafNotices((state) => state.unsteady);
  const dismiss = useOverleafNotices((state) => state.dismissUnsteady);
  return unsteady.map((path) => (
    <WorkspaceBanner key={path} tone="warning" data-testid="overleaf-unsteady-row">
      <Unplug aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1 select-text">{t(($) => $.collab.overleafBanners.unsteady, { path })}</p>
      <WorkspaceBannerButton tone="warning" onClick={() => dismiss(path)}>
        {t(($) => $.collab.files.dismiss)}
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  ));
}

function CompareDialog({ shown, onClose }: Readonly<{ shown: Shown; onClose: () => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const titleId = useId();
  const descriptionId = useId();
  const resolve = useOverleafNotices((state) => state.resolve);
  const resolving = useOverleafNotices((state) => state.resolving);
  const { path } = shown.entry;
  const merged = shown.kind === "merged";
  const [oldText, newText] = merged ? [shown.entry.before, shown.entry.after] : [shown.entry.mine, shown.entry.theirs];
  const keep = (choice: "mine" | "theirs") => void resolve(path, choice).then(onClose);
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
        {merged
          ? t(($) => $.collab.overleafBanners.mergedTitle, { path })
          : t(($) => $.collab.overleafBanners.reviewTitle, { path })}
      </h2>
      <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
        {merged
          ? t(($) => $.collab.overleafBanners.mergedDescription)
          : t(($) => $.collab.overleafBanners.reviewDescription)}
      </p>
      <div className="h-80 min-h-0 overflow-hidden rounded-md border">
        <InlineDiffPreview
          path={path}
          oldText={oldText}
          newText={newText}
          ariaLabel={t(($) => $.collab.overleafBanners.diffLabel)}
          className="h-full"
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} data-modal-initial-focus>
          {t(($) => $.common.actions.close)}
        </Button>
        {merged ? null : (
          <>
            <Button type="button" variant="outline" size="sm" disabled={resolving !== null} onClick={() => keep("theirs")}>
              {t(($) => $.collab.overleafBanners.useTheirs)}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={resolving !== null} onClick={() => keep("mine")}>
              {t(($) => $.collab.overleafBanners.useMine)}
            </Button>
          </>
        )}
      </div>
    </ModalShell>
  );
}

export function OverleafBanners() {
  const [shown, setShown] = useState<Shown | null>(null);
  return (
    <>
      <SignedOutBanner />
      <AccountChangedBanner />
      <MaintenanceBanner />
      <ReviewRows onShow={setShown} />
      <MergedRows onShow={setShown} />
      <UnsteadyRows />
      {shown ? <CompareDialog shown={shown} onClose={() => setShown(null)} /> : null}
      <OverleafDeleteDialog />
    </>
  );
}

import { LogOut, UserRoundCog } from "lucide-react";
import { useTranslation } from "react-i18next";
import { serverHost } from "@/components/library/overleaf/OverleafServerField";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "./live-store";

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

export function OverleafBanners() {
  return (
    <>
      <SignedOutBanner />
      <AccountChangedBanner />
    </>
  );
}

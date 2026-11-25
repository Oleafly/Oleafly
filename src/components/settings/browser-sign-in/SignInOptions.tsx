import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { ImportCookies } from "@/components/settings/browser-sign-in/ImportCookies";
import { useBrowserIcons } from "@/components/settings/browser-sign-in/use-browser-icons";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Spinner } from "@/components/ui/spinner";
import { TileButton } from "@/components/ui/tile-button";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { overleafSignInBrowsers, type OverleafSignInBrowser, type OverleafStatus } from "@/lib/overleaf";
import { serverHost } from "@/lib/overleaf-live";
import { cn } from "@/lib/utils";
import { useOverleafImportStore } from "@/store/overleaf-import";

const HERE = "oleafly";
const BIG_TILES = 4;
const BIG_COLUMNS: Readonly<Record<number, string>> = {
  2: "@lg:grid-cols-2",
  3: "@lg:grid-cols-3",
  4: "@lg:grid-cols-4",
};
const TILE = "h-auto flex-row items-center justify-start gap-3 p-2.5 [&_svg]:size-5";
const BUSY_TILE = "pointer-events-none border-ring bg-accent";
const BIG_TILE = "@lg:flex-col @lg:justify-center @lg:gap-2.5 @lg:px-2 @lg:py-4 @lg:text-center";

function useSignInBrowsers(): OverleafSignInBrowser[] | null {
  const [browsers, setBrowsers] = useState<OverleafSignInBrowser[] | null>(null);
  useEffect(() => {
    let live = true;
    overleafSignInBrowsers()
      .then((found) => {
        if (live) setBrowsers(found);
      })
      .catch((error: unknown) => {
        void logError("list browsers for Overleaf sign-in", error);
        if (live) setBrowsers([]);
      });
    return () => {
      live = false;
    };
  }, []);
  return browsers;
}

export interface SignInOptionsProps {
  server: string;
  onSignedIn(status: OverleafStatus): void;
}

export function SignInOptions({ server, onSignedIn }: Readonly<SignInOptionsProps>) {
  const { t } = useTranslation("settings");
  const browsers = useSignInBrowsers();
  const signing = useOverleafImportStore((state) => state.phase === "signing-in");
  const signingWith = useOverleafImportStore((state) => state.signingWith);
  const signedOut = useOverleafImportStore((state) => state.phase === "signed-out");
  const error = useOverleafImportStore((state) => state.error);
  const signIn = useOverleafImportStore((state) => state.signIn);
  const signInWithBrowser = useOverleafImportStore((state) => state.signInWithBrowser);
  const [attempted, setAttempted] = useState(false);
  const host = serverHost(server);

  const start = (run: () => Promise<boolean>) => {
    setAttempted(true);
    void run();
  };
  const startHere = () => start(() => signIn(t(($) => $.settings.integrations.overleaf.windowTitle, { server: host })));
  const waiting = signingWith
    ? t(($) => $.settings.integrations.overleaf.browserWaiting, { browser: signingWith, server: host })
    : t(($) => $.settings.integrations.overleaf.windowWaiting, { server: host });

  return (
    <div data-testid="sign-in-options" className="@container space-y-4">
      {browsers?.length === 0 ? <OnlyHere signing={signing} onStart={startHere} /> : null}
      {browsers && browsers.length > 0 ? (
        <Tiles
          browsers={browsers}
          signing={signing}
          onStartHere={startHere}
          onStart={(browser) => start(() => signInWithBrowser(browser))}
        />
      ) : null}
      {attempted && signedOut && error !== null ? <InlineAlert>{describeError(error)}</InlineAlert> : null}
      {signing ? (
        <output className="block text-xs">{waiting}</output>
      ) : (
        <p className="text-xs text-muted-foreground">
          {browsers?.length === 0
            ? t(($) => $.settings.integrations.overleaf.noBrowser)
            : t(($) => $.settings.integrations.overleaf.signInNote)}
        </p>
      )}
      <ImportCookies server={server} disabled={signing} onSignedIn={onSignedIn} />
      <RepeatedAccount />
    </div>
  );
}

function Tiles({
  browsers,
  signing,
  onStartHere,
  onStart,
}: Readonly<{
  browsers: OverleafSignInBrowser[];
  signing: boolean;
  onStartHere(): void;
  onStart(browser: OverleafSignInBrowser): void;
}>) {
  const { t } = useTranslation("settings");
  const icons = useBrowserIcons();
  const signingWith = useOverleafImportStore((state) => state.signingWith);
  const count = browsers.length + 1;
  const big = count <= BIG_TILES;
  const busy = signing ? (browsers.find((browser) => browser.name === signingWith)?.key ?? HERE) : null;
  const hintFor = (key: string, hint: string) =>
    busy === key ? t(($) => $.settings.integrations.overleaf.tileWaiting) : hint;
  const tile = (key: string) => ({
    className: cn(TILE, big && BIG_TILE, busy === key && BUSY_TILE),
    disabled: signing && busy !== key,
    "aria-busy": busy === key || undefined,
  });

  return (
    <div className={cn("grid grid-cols-2 gap-2.5", big ? BIG_COLUMNS[count] : "@lg:grid-cols-3")}>
      <TileButton
        data-testid="window-sign-in"
        {...tile(HERE)}
        icon={<AppIcon>{busy === HERE ? <Spinner size="sm" /> : <LeafLogo className="size-5" />}</AppIcon>}
        name="Oleafly"
        hint={hintFor(HERE, t(($) => $.settings.integrations.overleaf.tileHere))}
        onClick={onStartHere}
      />
      {browsers.map((browser) => (
        <TileButton
          key={browser.key}
          data-testid="browser-sign-in"
          {...tile(browser.key)}
          icon={
            <AppIcon url={icons[browser.key]}>{busy === browser.key ? <Spinner size="sm" /> : undefined}</AppIcon>
          }
          name={browser.product}
          hint={hintFor(browser.key, browser.packaging ?? t(($) => $.settings.integrations.overleaf.tileWindow))}
          onClick={() => onStart(browser)}
        />
      ))}
    </div>
  );
}

function OnlyHere({ signing, onStart }: Readonly<{ signing: boolean; onStart(): void }>) {
  const { t } = useTranslation("settings");
  return (
    <SettingsRow
      testId="window-sign-in-row"
      icon={
        <AppIcon>
          <LeafLogo className="size-5" />
        </AppIcon>
      }
      label={t(($) => $.settings.integrations.overleaf.windowLabel)}
      description={t(($) => $.settings.integrations.overleaf.windowDescription)}
      control={
        <Button type="button" size="sm" data-testid="window-sign-in" disabled={signing} onClick={onStart}>
          {signing ? <Spinner size="sm" /> : null}
          {t(($) => $.settings.integrations.overleaf.windowAction)}
        </Button>
      }
    />
  );
}

function RepeatedAccount() {
  const { t } = useTranslation("settings");
  const account = useOverleafImportStore((state) => state.repeated);
  useEffect(() => () => useOverleafImportStore.setState({ repeated: null }), []);
  if (account === null) return null;
  return (
    <output className="block select-text text-xs text-muted-foreground">
      {t(($) => $.settings.integrations.overleaf.sameAccount, { account })}
    </output>
  );
}

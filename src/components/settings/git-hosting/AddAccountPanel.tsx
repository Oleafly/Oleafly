import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { IntegrationError } from "@/components/settings/IntegrationCard";
import { DeviceCodeCard } from "@/components/settings/git-hosting/DeviceCodeCard";
import { ForgeBrandIcon } from "@/components/settings/git-hosting/ForgeBrandIcon";
import { decodeAppError, describeError } from "@/lib/app-error";
import {
  FORGE_PRESETS,
  TOKEN_PLACEHOLDER,
  hostLabel,
  kindLabel,
  tokenPageUrl,
  waitForDeviceSignIn,
} from "@/lib/forge";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { openInSystemBrowser } from "@/lib/system-browser";
import {
  forgeDetect,
  forgeDeviceCancel,
  forgeDevicePoll,
  forgeDeviceStart,
  type ForgeAccount,
  type ForgeDeviceStart,
  type ForgeFlavor,
  type ForgeKind,
} from "@/lib/tauri";
import { useForgeAccountsStore } from "@/store/forge-accounts";

type FoundServer = { base: string; kind: ForgeKind; flavor: ForgeFlavor | null; deviceFlow: boolean };

export const CA_EXTENSIONS = ["pem", "crt", "cer", "der"];

/** Add an account (or sign in to one again): pick a hosted service or type a
 * server address, then sign in in the browser or paste an access token. */
export function AddAccountPanel({
  initialBase,
  initialCaFile = null,
  onDone,
  onCancel,
}: Readonly<{
  initialBase?: string;
  initialCaFile?: string | null;
  onDone: (account: ForgeAccount) => void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const [step, setStep] = useState<"choose" | "server" | "signIn">(initialBase ? "server" : "choose");
  const [address, setAddress] = useState(initialBase ?? "");
  const [pendingBase, setPendingBase] = useState<string | null>(null);
  const [caFile, setCaFile] = useState<string | null>(initialCaFile);
  // "Remove" was pressed: the sign-in clears the account's CA file. Without
  // it, an account keeps the file it has.
  const [caRemoved, setCaRemoved] = useState(false);
  const [needsCa, setNeedsCa] = useState(false);
  const [unknownBase, setUnknownBase] = useState<string | null>(null);
  const [server, setServer] = useState<FoundServer | null>(null);
  const [useToken, setUseToken] = useState(false);
  const [token, setToken] = useState("");
  const fieldId = useId();
  const accounts = useForgeAccountsStore((s) => s.accounts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<ForgeDeviceStart | null>(null);
  // Bumping this drops every reply of an older attempt (Cancel, unmount).
  const generation = useRef(0);
  const deviceRef = useRef<ForgeDeviceStart | null>(null);

  useEffect(
    () => () => {
      generation.current += 1;
      if (deviceRef.current) void forgeDeviceCancel(deviceRef.current.flowId);
    },
    [],
  );

  const detect = useCallback(async (base: string, ca: string | null) => {
    const run = ++generation.current;
    setPendingBase(base);
    setBusy(true);
    setError(null);
    setNeedsCa(false);
    setUnknownBase(null);
    try {
      const info = await forgeDetect(base, ca);
      if (run !== generation.current) return;
      if (info.kind) {
        setServer({ base: info.base, kind: info.kind, flavor: info.flavor, deviceFlow: info.deviceFlow });
        setUseToken(!info.deviceFlow);
        setStep("signIn");
      } else {
        setStep("server");
        setUnknownBase(info.base);
      }
    } catch (error_) {
      if (run !== generation.current) return;
      setStep("server");
      if (decodeAppError(error_)?.code === "git.tls_failed") setNeedsCa(true);
      setError(describeError(error_));
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initialBase) void detect(initialBase, initialCaFile);
  }, [detect, initialBase, initialCaFile]);

  const chooseKind = (kind: ForgeKind) => {
    if (!unknownBase) return;
    setServer({ base: unknownBase, kind, flavor: null, deviceFlow: false });
    setUseToken(true);
    setUnknownBase(null);
    setError(null);
    setStep("signIn");
  };

  const chooseCa = async () => {
    const picked = await pickOpenPath({
      title: t(($) => $.settings.gitHosting.add.caPickerTitle),
      multiple: false,
      filters: [{ name: t(($) => $.settings.gitHosting.add.caFilter), extensions: CA_EXTENSIONS }],
    });
    if (typeof picked !== "string") return;
    setCaFile(picked);
    setCaRemoved(false);
    const base = pendingBase ?? address.trim();
    if (base) void detect(base, picked);
  };

  const signInWithBrowser = async () => {
    if (!server) return;
    const run = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const start = await forgeDeviceStart(server.base);
      if (run !== generation.current) {
        void forgeDeviceCancel(start.flowId);
        return;
      }
      deviceRef.current = start;
      setDevice(start);
      void openInSystemBrowser(start.verificationUriComplete ?? start.verificationUri);
      const account = await waitForDeviceSignIn(start, forgeDevicePoll, {
        cancelled: () => run !== generation.current,
      });
      if (run !== generation.current) return;
      deviceRef.current = null;
      setDevice(null);
      if (!account) {
        void forgeDeviceCancel(start.flowId);
        setError(t(($) => $.settings.gitHosting.device.timedOut));
        return;
      }
      useForgeAccountsStore.getState().accountSignedIn(account);
      onDone(account);
    } catch (error_) {
      if (run !== generation.current) return;
      // Let the backend drop the flow and any grant it kept.
      const failed = deviceRef.current;
      deviceRef.current = null;
      if (failed) void forgeDeviceCancel(failed.flowId);
      setDevice(null);
      setError(describeError(error_));
    } finally {
      if (run === generation.current) setBusy(false);
    }
  };

  const cancelDevice = () => {
    generation.current += 1;
    const current = deviceRef.current;
    deviceRef.current = null;
    if (current) void forgeDeviceCancel(current.flowId);
    setDevice(null);
    setBusy(false);
  };

  const connect = async () => {
    const value = token.trim();
    if (!server || !value) return;
    const run = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const account = await useForgeAccountsStore
        .getState()
        .signInWithToken({
          base: server.base,
          kind: server.kind,
          token: value,
          // An empty path tells the backend to clear the account's CA file.
          caFile: caRemoved ? "" : caFile,
        });
      if (run !== generation.current) return;
      setToken("");
      onDone(account);
    } catch (error_) {
      if (run === generation.current) setError(describeError(error_));
    } finally {
      if (run === generation.current) setBusy(false);
    }
  };

  const host = server ? hostLabel(server.base) : "";
  // One account per server: signing in again replaces the one it has.
  const replaced = server ? accounts.find((account) => account.base === server.base) : undefined;
  const scopes = server
    ? {
        github: t(($) => $.settings.gitHosting.add.scopesGithub),
        gitlab: t(($) => $.settings.gitHosting.add.scopesGitlab),
        gitea: t(($) => $.settings.gitHosting.add.scopesGitea),
      }[server.kind]
    : "";

  const renderChoose = () => (
    <div className="grid gap-2 sm:grid-cols-2">
      {FORGE_PRESETS.map((preset) => (
        <Button
          key={preset.id}
          variant="outline"
          className="justify-start"
          data-testid={`git-hosting-preset-${preset.id}`}
          disabled={busy}
          onClick={() => {
            setAddress(preset.base);
            void detect(preset.base, caFile);
          }}
        >
          <ForgeBrandIcon base={preset.base} kind={preset.kind} />
          {preset.label}
        </Button>
      ))}
      <Button
        variant="outline"
        className="justify-start"
        data-testid="git-hosting-preset-other"
        disabled={busy}
        onClick={() => {
          setError(null);
          setStep("server");
        }}
      >
        <Server />
        {t(($) => $.settings.gitHosting.add.otherServer)}
      </Button>
    </div>
  );

  const renderServer = () => (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-server`} className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t(($) => $.settings.gitHosting.add.serverLabel)}
        </span>
        <span className="flex gap-2">
          <Input
            id={`${fieldId}-server`}
            data-testid="git-hosting-server-url"
            value={address}
            disabled={busy}
            placeholder={t(($) => $.settings.gitHosting.add.serverPlaceholder)}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && address.trim()) void detect(address.trim(), caFile);
            }}
            className="h-9"
          />
          <Button
            size="sm"
            className="h-9"
            data-testid="git-hosting-server-continue"
            disabled={busy || !address.trim()}
            onClick={() => void detect(address.trim(), caFile)}
          >
            {busy ? <Spinner /> : null}
            {t(($) => $.settings.gitHosting.add.continue)}
          </Button>
        </span>
      </label>
      {busy ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.gitHosting.add.detecting)}</p>
      ) : null}
      {unknownBase ? (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">
            {t(($) => $.settings.gitHosting.add.chooseKind)}
          </legend>
          <div className="flex flex-wrap gap-2" data-testid="git-hosting-kind">
            <Button size="sm" variant="outline" data-testid="git-hosting-kind-gitlab" onClick={() => chooseKind("gitlab")}>
              {"GitLab"}
            </Button>
            <Button size="sm" variant="outline" data-testid="git-hosting-kind-gitea" onClick={() => chooseKind("gitea")}>
              {t(($) => $.settings.gitHosting.add.kindGitea)}
            </Button>
            <Button size="sm" variant="outline" data-testid="git-hosting-kind-github" onClick={() => chooseKind("github")}>
              {t(($) => $.settings.gitHosting.add.kindGithub)}
            </Button>
          </div>
        </fieldset>
      ) : null}
    </div>
  );

  const renderSignIn = (found: FoundServer) => (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t(($) => $.settings.gitHosting.add.found, { kind: kindLabel({ kind: found.kind, flavor: found.flavor ?? undefined }) })}
      </p>
      {replaced ? (
        <p className="text-xs text-muted-foreground" data-testid="git-hosting-replaces">
          {t(($) => $.settings.gitHosting.add.replaces, { login: replaced.login, host })}
        </p>
      ) : null}
      {found.deviceFlow && !useToken ? (
        <div className="space-y-2">
          <Button data-testid="git-hosting-sign-in-browser" disabled={busy} onClick={() => void signInWithBrowser()}>
            {busy ? <Spinner /> : <ForgeBrandIcon base={found.base} kind={found.kind} flavor={found.flavor} />}
            {t(($) => $.settings.gitHosting.add.signInBrowser, { host })}
          </Button>
          <p className="text-xs text-muted-foreground">{t(($) => $.settings.gitHosting.add.browserHint)}</p>
          <Button
            variant="link"
            size="xs"
            className="h-auto px-0"
            data-testid="git-hosting-use-token"
            onClick={() => setUseToken(true)}
          >
            {t(($) => $.settings.gitHosting.add.useToken)}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`${fieldId}-token`} className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t(($) => $.settings.gitHosting.add.tokenLabel)}
            </span>
            <span className="flex gap-2">
              <Input
                id={`${fieldId}-token`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                data-testid="git-hosting-token"
                value={token}
                disabled={busy}
                placeholder={TOKEN_PLACEHOLDER[found.kind] || t(($) => $.settings.gitHosting.add.tokenLabel)}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void connect();
                }}
                className="h-9"
              />
              <Button
                size="sm"
                className="h-9"
                data-testid="git-hosting-token-connect"
                disabled={busy || !token.trim()}
                onClick={() => void connect()}
              >
                {busy ? <Spinner /> : null}
                {t(($) => $.settings.gitHosting.add.connect)}
              </Button>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            <Button
              variant="link"
              size="xs"
              className="h-auto px-0"
              data-testid="git-hosting-token-page"
              onClick={() => void openInSystemBrowser(tokenPageUrl(found.base, found.kind))}
            >
              {t(($) => $.settings.gitHosting.add.createToken, { host })}
              <ExternalLink />
            </Button>{" "}
            {scopes}
          </p>
        </div>
      )}
    </div>
  );

  const renderBody = () => {
    if (device && server) return <DeviceCodeCard start={device} host={host} onCancel={cancelDevice} />;
    if (step === "choose") return renderChoose();
    if (step === "signIn" && server) return renderSignIn(server);
    return renderServer();
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4" data-testid="git-hosting-add-panel">
      <h4 className="text-sm font-semibold">{t(($) => $.settings.gitHosting.add.title)}</h4>
      {renderBody()}
      {(needsCa || caFile) && step !== "choose" && !device ? (
        <div className="space-y-1.5 rounded-md border border-dashed p-3">
          <div className="text-xs font-medium">{t(($) => $.settings.gitHosting.add.caLabel)}</div>
          <p className="text-xs text-muted-foreground">{t(($) => $.settings.gitHosting.add.caHint)}</p>
          {caFile ? <p className="break-all text-xs">{caFile}</p> : null}
          <div className="flex gap-2">
            <Button size="xs" variant="outline" data-testid="git-hosting-ca-choose" disabled={busy} onClick={() => void chooseCa()}>
              {t(($) => $.settings.gitHosting.add.caChoose)}
            </Button>
            {caFile ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setCaFile(null);
                  setCaRemoved(true);
                }}
              >
                {t(($) => $.settings.gitHosting.add.caRemove)}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? <IntegrationError>{error}</IntegrationError> : null}
      {device ? null : (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" data-testid="git-hosting-add-cancel" onClick={onCancel}>
            {t(($) => $.common.actions.cancel)}
          </Button>
        </div>
      )}
    </div>
  );
}

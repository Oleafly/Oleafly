import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/intl";
import {
  collabAdminAddAllowlist,
  collabAdminAllowlist,
  collabAdminRemoveAllowlist,
  type CollabAllowlistEntry,
  type CollabNewAllowlistEntry,
  type CollabProvider,
} from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";
import { RolePicker } from "./RolePicker";
import { toServerRole, type ServerRole } from "./roles";

type MatchKind = "email" | "login";

export function AllowlistTab({
  serverId,
  actor,
  providers,
}: Readonly<{ serverId: string; actor: ServerRole; providers: readonly CollabProvider[] }>) {
  const { t } = useTranslation(["collab"]);
  const [entries, setEntries] = useState<CollabAllowlistEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [kind, setKind] = useState<MatchKind>("email");
  const [value, setValue] = useState("");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [role, setRole] = useState<ServerRole>("member");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const loginProviders = providers.filter((item) => item.kind === "github" || item.kind === "oidc");
  const provider = providerId ?? loginProviders[0]?.id ?? null;

  useEffect(() => {
    let active = true;
    void request;
    setLoadError(null);
    collabAdminAllowlist(serverId).then(
      (next) => {
        if (active) setEntries(next);
      },
      (error: unknown) => {
        if (active) setLoadError(collabErrorMessage(collabErrorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [serverId, request]);

  const providerName = (id: string) => providers.find((item) => item.id === id)?.label ?? id;

  const entryLabel = (entry: CollabAllowlistEntry) => {
    const { matcher } = entry;
    return matcher.kind === "email"
      ? matcher.email
      : t(($) => $.collab.admin.allowlist.loginEntry, {
          login: matcher.login,
          provider: providerName(matcher.provider),
        });
  };

  const addEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "" || (kind === "login" && provider === null)) return;
    const entry: CollabNewAllowlistEntry = {
      matcher:
        kind === "email"
          ? { kind: "email", email: trimmed }
          : { kind: "provider_login", provider: provider ?? "", login: trimmed },
      role,
    };
    setSaving(true);
    setFormError(null);
    try {
      const created = await collabAdminAddAllowlist(serverId, entry);
      setEntries((current) => [...(current ?? []), created]);
      setValue("");
    } catch (error) {
      setFormError(collabErrorMessage(collabErrorCode(error), "allowlist"));
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entry: CollabAllowlistEntry) => {
    setBusyId(entry.id);
    setRowError(null);
    try {
      await collabAdminRemoveAllowlist(serverId, entry.id);
      setEntries((current) => current?.filter((item) => item.id !== entry.id) ?? null);
    } catch (error) {
      setRowError(collabErrorMessage(collabErrorCode(error), "allowlist"));
    } finally {
      setBusyId(null);
    }
  };

  const renderEntries = () => {
    if (loadError) {
      return (
        <LoadFailed
          message={t(($) => $.collab.admin.loadFailed)}
          reason={loadError}
          onRetry={() => setRequest((count) => count + 1)}
        />
      );
    }
    if (!entries) return <LoadingState size="compact" label={t(($) => $.collab.admin.allowlist.loading)} />;
    if (entries.length === 0) {
      return (
        <EmptyState
          size="compact"
          className="rounded-lg border border-dashed px-4 py-6"
          title={t(($) => $.collab.admin.allowlist.empty)}
        />
      );
    }
    return (
      <ul className="divide-y rounded-lg border bg-card">
        {entries.map((entry) => {
          const label = entryLabel(entry);
          const entryRole = toServerRole(entry.role);
          return (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.bound_account
                    ? t(($) => $.collab.admin.allowlist.bound)
                    : t(($) => $.collab.admin.allowlist.unbound)}
                  {" · "}
                  {t(($) => $.collab.admin.added, { date: formatDate(entry.created_at) })}
                </p>
              </div>
              <Badge variant="muted" size="sm">
                {entryRole === null ? entry.role : t(($) => $.collab.roles[entryRole])}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t(($) => $.collab.admin.allowlist.removeNamed, { entry: label })}
                className="hover:bg-destructive/10 hover:text-destructive"
                disabled={busyId === entry.id}
                onClick={() => void removeEntry(entry)}
              >
                <Trash2 aria-hidden />
                {t(($) => $.collab.admin.allowlist.remove)}
              </Button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.allowlist.description)}</p>
      <form
        className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3"
        onSubmit={(event) => void addEntry(event)}
      >
        <Select value={kind} onValueChange={(next) => setKind(next === "login" ? "login" : "email")}>
          <SelectTrigger aria-label={t(($) => $.collab.admin.allowlist.matchLabel)} className="h-8 w-[10rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            <SelectItem value="email">{t(($) => $.collab.admin.allowlist.match.email)}</SelectItem>
            <SelectItem value="login" disabled={loginProviders.length === 0}>
              {t(($) => $.collab.admin.allowlist.match.login)}
            </SelectItem>
          </SelectContent>
        </Select>
        {kind === "login" && loginProviders.length > 1 ? (
          <Select value={provider ?? undefined} onValueChange={setProviderId}>
            <SelectTrigger
              aria-label={t(($) => $.collab.admin.allowlist.providerLabel)}
              className="h-8 w-[10rem] text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {loginProviders.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Input
          aria-label={
            kind === "email"
              ? t(($) => $.collab.admin.allowlist.match.email)
              : t(($) => $.collab.admin.allowlist.match.login)
          }
          inputMode={kind === "email" ? "email" : "text"}
          className="h-8 min-w-[12rem] flex-1 text-xs"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={
            kind === "email"
              ? t(($) => $.collab.admin.allowlist.emailPlaceholder)
              : t(($) => $.collab.admin.allowlist.loginPlaceholder)
          }
          spellCheck={false}
          autoComplete="off"
        />
        <RolePicker actor={actor} value={role} label={t(($) => $.collab.admin.allowlist.roleLabel)} onChange={setRole} />
        <Button
          type="submit"
          size="sm"
          disabled={saving || value.trim() === "" || (kind === "login" && provider === null)}
        >
          <Plus aria-hidden />
          {t(($) => $.collab.admin.allowlist.add)}
        </Button>
      </form>
      {formError ? <InlineAlert>{formError}</InlineAlert> : null}
      {renderEntries()}
      {rowError ? <InlineAlert>{rowError}</InlineAlert> : null}
    </div>
  );
}

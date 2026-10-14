import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/intl";
import {
  collabAdminAddDomainRule,
  collabAdminDomainRules,
  collabAdminRemoveDomainRule,
  type CollabDomainRule,
  type CollabNewDomainRule,
} from "@/lib/tauri";
import { collabErrorText } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";
import { RolePicker } from "./RolePicker";
import { toServerRole, type ServerRole } from "./roles";

export const DOMAIN_RULE_ROLES: readonly ServerRole[] = ["member", "guest"];

export function normalizeDomain(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

export function DomainRulesTab({ serverId, actor }: Readonly<{ serverId: string; actor: ServerRole }>) {
  const { t } = useTranslation(["collab"]);
  const [rules, setRules] = useState<CollabDomainRule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [domain, setDomain] = useState("");
  const [role, setRole] = useState<ServerRole>("member");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useMemo(() => ({ serverId, request }), [serverId, request]);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    collabAdminDomainRules(load.serverId).then(
      (next) => {
        if (active) setRules(next);
      },
      (error: unknown) => {
        if (active) setLoadError(collabErrorText(error));
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const addRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = normalizeDomain(domain);
    if (value === "") return;
    const rule: CollabNewDomainRule = { domain: value, role };
    setSaving(true);
    setFormError(null);
    try {
      const created = await collabAdminAddDomainRule(serverId, rule);
      setRules((current) => [...(current ?? []), created]);
      setDomain("");
    } catch (error) {
      setFormError(collabErrorText(error, "domains"));
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (rule: CollabDomainRule) => {
    setBusyId(rule.id);
    setRowError(null);
    try {
      await collabAdminRemoveDomainRule(serverId, rule.id);
      setRules((current) => current?.filter((item) => item.id !== rule.id) ?? null);
    } catch (error) {
      setRowError(collabErrorText(error, "domains"));
    } finally {
      setBusyId(null);
    }
  };

  const renderRules = () => {
    if (loadError) {
      return (
        <LoadFailed
          message={t(($) => $.collab.admin.loadFailed)}
          reason={loadError}
          onRetry={() => setRequest((count) => count + 1)}
        />
      );
    }
    if (!rules) return <LoadingState size="compact" label={t(($) => $.collab.admin.domains.loading)} />;
    if (rules.length === 0) {
      return (
        <EmptyState
          size="compact"
          className="rounded-lg border border-dashed px-4 py-6"
          title={t(($) => $.collab.admin.domains.empty)}
        />
      );
    }
    return (
      <ul className="divide-y rounded-lg border bg-card">
        {rules.map((rule) => {
          const ruleRole = toServerRole(rule.role);
          return (
            <li key={rule.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm">{rule.domain}</p>
                <p className="text-xs text-muted-foreground">
                  {t(($) => $.collab.admin.added, { date: formatDate(rule.created_at) })}
                </p>
              </div>
              <Badge variant="muted" size="sm">
                {ruleRole === null ? rule.role : t(($) => $.collab.roles[ruleRole])}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t(($) => $.collab.admin.domains.removeNamed, { domain: rule.domain })}
                className="hover:bg-destructive/10 hover:text-destructive"
                disabled={busyId === rule.id}
                onClick={() => void removeRule(rule)}
              >
                <Trash2 aria-hidden />
                {t(($) => $.collab.admin.domains.remove)}
              </Button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.domains.description)}</p>
      <form
        className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3"
        onSubmit={(event) => void addRule(event)}
      >
        <Input
          aria-label={t(($) => $.collab.admin.domains.domainLabel)}
          className="h-8 min-w-[12rem] flex-1 font-mono text-xs"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder={t(($) => $.collab.admin.domains.domainPlaceholder)}
          spellCheck={false}
          autoComplete="off"
        />
        <RolePicker
          actor={actor}
          value={role}
          roles={DOMAIN_RULE_ROLES}
          label={t(($) => $.collab.admin.domains.roleLabel)}
          onChange={setRole}
        />
        <Button type="submit" size="sm" disabled={saving || normalizeDomain(domain) === ""}>
          <Plus aria-hidden />
          {t(($) => $.collab.admin.domains.add)}
        </Button>
      </form>
      {formError ? <InlineAlert>{formError}</InlineAlert> : null}
      {renderRules()}
      {rowError ? <InlineAlert>{rowError}</InlineAlert> : null}
    </div>
  );
}

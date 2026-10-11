import { useId } from "react";
import { useTranslation } from "react-i18next";
import { CircleMinus, Info, XCircle } from "lucide-react";
import { CheckBadge } from "@/components/ui/check-badge";
import { i18n } from "@/i18n";
import { formatNumber } from "@/lib/intl";
import type { CollabCheckId, CollabConnectionCheck } from "@/lib/tauri";
import { COLLAB_ERROR_CODES, collabErrorMessage } from "./errors";

const CHECK_KEYS = {
  reachable: "reachable",
  https: "https",
  protocol: "protocol",
  websocket: "webSocket",
  sign_in_providers: "signInProviders",
  email: "email",
  clock: "clock",
} as const satisfies Record<CollabCheckId, string>;

type CheckKey = (typeof CHECK_KEYS)[keyof typeof CHECK_KEYS];

const CHECK_STATUSES = ["pass", "fail", "info", "skipped"] as const;

type CheckStatus = (typeof CHECK_STATUSES)[number];

const DETAIL_TOKENS: ReadonlySet<string> = new Set(["loopback", "configured", "not_configured"]);

export function checkKey(id: string): CheckKey | null {
  return Object.hasOwn(CHECK_KEYS, id) ? CHECK_KEYS[id as keyof typeof CHECK_KEYS] : null;
}

export function checkStatus(status: string): CheckStatus {
  return CHECK_STATUSES.find((value) => value === status) ?? "info";
}

export function checkSentence(key: CheckKey, status: CheckStatus, detail: string | null): CheckStatus {
  return key === "email" && detail === "configured" ? "pass" : status;
}

export function checkDetail(key: CheckKey, status: CheckStatus, detail: string | null): string | null {
  if (detail === null || detail.trim() === "" || DETAIL_TOKENS.has(detail)) return null;
  const code = COLLAB_ERROR_CODES.find((value) => value === detail);
  if (code) return collabErrorMessage(code);
  if (key === "clock") {
    const seconds = Number(detail);
    if (!Number.isFinite(seconds)) return detail;
    return i18n.t(($) => $.collab.section.checks.clockSkew, { seconds: formatNumber(Math.abs(Math.round(seconds))) });
  }
  if (key === "protocol" && status === "pass") return null;
  return detail;
}

function StatusIcon({ status }: Readonly<{ status: CheckStatus }>) {
  if (status === "pass") return <CheckBadge tone="success" />;
  if (status === "fail") return <XCircle aria-hidden className="size-4 shrink-0 text-destructive" />;
  if (status === "info") return <Info aria-hidden className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />;
  return <CircleMinus aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

export function ConnectionChecks({ checks }: Readonly<{ checks: readonly CollabConnectionCheck[] }>) {
  const { t } = useTranslation(["collab"]);
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-2">
      <h4 id={titleId} className="text-xs font-medium">
        {t(($) => $.collab.section.checks.title)}
      </h4>
      <ul className="divide-y rounded-md border bg-background">
        {checks.map((check) => {
          const key = checkKey(check.id);
          if (!key) return null;
          const status = checkStatus(check.status);
          const detail = check.detail ?? null;
          const sentence = checkSentence(key, status, detail);
          const extra = checkDetail(key, status, detail);
          return (
            <li key={check.id} data-check={key} data-status={status} className="flex items-start gap-2.5 px-3 py-2">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                <StatusIcon status={status} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs">
                  <span className="font-medium">{t(($) => $.collab.section.checks.items[key].label)}</span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {t(($) => $.collab.section.checks.status[status])}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(($) => $.collab.section.checks.items[key][sentence])}
                </p>
                {extra ? (
                  <p className="mt-0.5 select-text break-words text-[0.6875rem] text-muted-foreground">{extra}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

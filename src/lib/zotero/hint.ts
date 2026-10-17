import type { ZoteroLibraryStatus } from "@oleafly/backend-port";
import { i18n } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";

export type ZoteroHintKind =
  | "apiDisabled"
  | "unsupported"
  | "keyRejected"
  | "closedCached"
  | "closed"
  | "bbtMissing";

export function zoteroHint(status: ZoteroLibraryStatus | null): ZoteroHintKind | null {
  if (!status) return null;
  const local = status.local.state;
  if (local === "apiDisabled") return "apiDisabled";
  if (local === "unsupported") return "unsupported";
  if (status.web === "keyRejected") return "keyRejected";
  if (local === "notRunning") {
    if (status.source === "web") return null;
    if (status.itemCount > 0) return "closedCached";
    return status.local.installed ? "closed" : null;
  }
  if (local === "ready" && !status.local.bbtVersion && status.bbtSeen) return "bbtMissing";
  return null;
}

export function zoteroSearchable(status: ZoteroLibraryStatus | null): boolean {
  return Boolean(status && status.itemCount > 0);
}

export function zoteroHintMessage(kind: ZoteroHintKind, status: ZoteroLibraryStatus | null): string {
  switch (kind) {
    case "apiDisabled":
      return i18n.t(($) => $.references.zotero.hint.apiDisabled);
    case "unsupported":
      return i18n.t(($) => $.references.zotero.hint.unsupported);
    case "keyRejected":
      return i18n.t(($) => $.references.zotero.hint.keyRejected);
    case "closed":
      return i18n.t(($) => $.references.zotero.hint.closed);
    case "bbtMissing":
      return i18n.t(($) => $.references.zotero.hint.bbtMissing);
    case "closedCached":
      return status?.lastSync
        ? i18n.t(($) => $.references.zotero.hint.closedCached, { time: formatRelativeTimeFrom(status.lastSync, Date.now(), { justNow: i18n.t(($) => $.researchTools.tasks.relative.justNow) }) })
        : i18n.t(($) => $.references.zotero.hint.closed);
  }
}

export function zoteroHintText(status: ZoteroLibraryStatus | null): string | null {
  const kind = zoteroHint(status);
  return kind ? zoteroHintMessage(kind, status) : null;
}

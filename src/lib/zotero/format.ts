import type { ZoteroHit, ZoteroLibraryStatus } from "@oleafly/backend-port";
import { i18n } from "@/i18n";
import { plainText } from "./rich-text";

const TITLE_LENGTH = 56;

export function truncated(text: string): string {
  return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : text;
}

export function authorsLabel(authors: readonly string[], count: number): string {
  if (authors.length === 0) return "";
  if (count === 1 || authors.length === 1) return authors[0];
  if (count === 2) {
    return i18n.t(($) => $.references.zotero.completion.authorsTwo, { first: authors[0], second: authors[1] });
  }
  return i18n.t(($) => $.references.zotero.completion.authorsMany, { first: authors[0] });
}

export function libraryLabel(hit: ZoteroHit, status: ZoteroLibraryStatus | null): string {
  if (hit.library === "user") return i18n.t(($) => $.references.zotero.completion.library);
  return status?.libraries.find((library) => library.id === hit.library)?.name || i18n.t(($) => $.references.zotero.completion.library);
}

export function hitByline(hit: ZoteroHit): string {
  return [authorsLabel(hit.authors, hit.authorCount), hit.year ?? i18n.t(($) => $.references.zotero.completion.noYear)]
    .filter(Boolean)
    .join(" ");
}

export function hitTitle(hit: ZoteroHit): string {
  return plainText(hit.title);
}

export function hitDetail(hit: ZoteroHit, status: ZoteroLibraryStatus | null): string {
  return [hitByline(hit), libraryLabel(hit, status), truncated(hitTitle(hit))].filter(Boolean).join(" · ");
}

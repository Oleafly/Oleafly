import { i18n } from "@/i18n";
import type { CloudProviderKind } from "@/lib/cloud";

/** The name the cloud strings use for a provider, or for cloud storage in
 * general when none is chosen. Brand names stay as they are; the generic
 * names are translated. */
export function cloudProviderName(kind: CloudProviderKind | null | undefined): string {
  switch (kind) {
    case "dropbox":
      return "Dropbox";
    case "google_drive":
      return "Google Drive";
    case "s3":
      return i18n.t(($) => $.cloud.providers.s3);
    default:
      return i18n.t(($) => $.cloud.providers.generic);
  }
}

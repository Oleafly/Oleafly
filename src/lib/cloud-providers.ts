import { i18n } from "@/i18n";
import type { CloudProviderKind } from "@/lib/cloud";

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

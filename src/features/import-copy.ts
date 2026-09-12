import { i18n } from "@/i18n";

export function conversionNotice(): string {
  return i18n.t(($) => $.core.import.conversionNotice);
}

import { i18n } from "@/i18n";
import { toast } from "@/lib/toast";

export function closeAfterCrash(close: () => void): void {
  close();
  toast.error(i18n.t(($) => $.shell.errorBoundary.surfaceClosed));
}

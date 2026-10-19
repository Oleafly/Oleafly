import { useEffect, useState } from "react";
import type { StoredAttachmentRef } from "@/components/ai/composer/types";
import { attachmentObjectUrl } from "@/lib/attachments";

/** An object URL for a stored file, or `failed` when it cannot be read. */
export function useAttachmentUrl(
  scope: string | null,
  ref: StoredAttachmentRef | undefined,
): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({
    key: "",
    url: null,
    failed: false,
  });
  const key = ref ? `${scope ?? ""}:${ref.sha256}:${ref.mime}` : "";
  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    attachmentObjectUrl(scope, ref.sha256, ref.mime).then(
      (url) => {
        if (!cancelled) setState({ key, url, failed: false });
      },
      () => {
        if (!cancelled) setState({ key, url: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, ref, scope]);
  if (!ref || state.key !== key) return { url: null, failed: false };
  return { url: state.url, failed: state.failed };
}

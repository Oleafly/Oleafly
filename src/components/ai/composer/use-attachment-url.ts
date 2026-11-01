import { useEffect, useState } from "react";
import type { StoredAttachmentRef } from "@/components/ai/composer/types";
import { attachmentObjectUrl, holdAttachmentObjectUrl } from "@/lib/attachments";

export function useAttachmentUrl(
  scope: string | null,
  ref: StoredAttachmentRef | undefined,
): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({
    key: "",
    url: null,
    failed: false,
  });
  const sha256 = ref?.sha256;
  const mime = ref?.mime;
  const key = sha256 === undefined ? "" : `${scope ?? ""}:${sha256}:${mime}`;
  useEffect(() => {
    if (sha256 === undefined || mime === undefined) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    const settle = (url: string | null, failed: boolean) =>
      setState((current) =>
        current.key === key && current.url === url && current.failed === failed ? current : { key, url, failed },
      );
    attachmentObjectUrl(scope, sha256, mime).then(
      (url) => {
        if (cancelled) return;
        release = holdAttachmentObjectUrl(url);
        settle(url, false);
      },
      () => {
        if (!cancelled) settle(null, true);
      },
    );
    return () => {
      cancelled = true;
      release?.();
    };
  }, [key, sha256, mime, scope]);
  if (sha256 === undefined || state.key !== key) return { url: null, failed: false };
  return { url: state.url, failed: state.failed };
}

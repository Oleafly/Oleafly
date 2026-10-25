import { useEffect, useState } from "react";
import type { StoredAttachmentRef } from "@/components/ai/composer/types";
import { attachmentObjectUrl, holdAttachmentObjectUrl } from "@/lib/attachments";

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
  // Callers often build `ref` anew on every render, so the effect depends on
  // its two fields: depending on the object would reload on every render.
  const sha256 = ref?.sha256;
  const mime = ref?.mime;
  const key = sha256 === undefined ? "" : `${scope ?? ""}:${sha256}:${mime}`;
  useEffect(() => {
    if (sha256 === undefined || mime === undefined) return;
    let cancelled = false;
    // Held while shown: the cache may drop it for newer files meanwhile.
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

import type { MessageRef } from "@oleafly/preflight";
import { i18n } from "@/i18n";

export type PreflightTranslate = (key: string, params?: Record<string, string | number>) => string;

export interface DetailedMessage {
  detail: MessageRef;
  detailParts?: MessageRef[];
}

export function renderMessage(translate: PreflightTranslate, ref: MessageRef): string {
  return translate(`preflight:${ref.key}`, ref.params);
}

export function renderDetail(translate: PreflightTranslate, source: DetailedMessage): string {
  return [source.detail, ...(source.detailParts ?? [])]
    .map((ref) => renderMessage(translate, ref))
    .join(" ");
}

function activeTranslate(): PreflightTranslate {
  return i18n.t as unknown as PreflightTranslate;
}

function englishTranslate(): PreflightTranslate {
  return i18n.getFixedT("en") as unknown as PreflightTranslate;
}

export function preflightMessage(ref: MessageRef): string {
  return renderMessage(activeTranslate(), ref);
}

export function preflightDetail(source: DetailedMessage): string {
  return renderDetail(activeTranslate(), source);
}

export function preflightMessageInEnglish(ref: MessageRef): string {
  return renderMessage(englishTranslate(), ref);
}

export function preflightDetailInEnglish(source: DetailedMessage): string {
  return renderDetail(englishTranslate(), source);
}

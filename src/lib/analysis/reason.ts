import { i18n } from "@/i18n";
import enIntelligence from "@/i18n/locales/en/intelligence.json" with { type: "json" };

export type ProjectAnalysisReasonKey =
  keyof typeof enIntelligence.analysis.reasons;

export type LanguageServiceReasonKey =
  keyof typeof enIntelligence.languageService.reasons;

export type AnalysisReasonKey =
  | ProjectAnalysisReasonKey
  | LanguageServiceReasonKey;

export interface AnalysisReasonMessage {
  key: AnalysisReasonKey;
  params?: Readonly<Record<string, string | number>>;
}

export interface AnalysisReasonText {
  text: string;
}

export type AnalysisReason = AnalysisReasonMessage | AnalysisReasonText;

function isLanguageServiceReasonKey(
  key: AnalysisReasonKey,
): key is LanguageServiceReasonKey {
  return key in enIntelligence.languageService.reasons;
}

export function analysisReasonText(
  reason: AnalysisReason | undefined | null,
): string | undefined {
  if (!reason) return undefined;
  if ("text" in reason) return reason.text;
  const key = reason.key;
  if (isLanguageServiceReasonKey(key)) {
    return i18n.t(
      ($) => $.intelligence.languageService.reasons[key],
      reason.params,
    );
  }
  return i18n.t(($) => $.intelligence.analysis.reasons[key], reason.params);
}

export function analysisReasonEnglishText(reason: AnalysisReason): string {
  if ("text" in reason) return reason.text;
  const key = reason.key;
  return isLanguageServiceReasonKey(key)
    ? enIntelligence.languageService.reasons[key]
    : enIntelligence.analysis.reasons[key];
}

export function analysisReasonError(reason: AnalysisReason): Error {
  const error = new Error(analysisReasonEnglishText(reason));
  return Object.assign(error, { analysisReason: reason });
}

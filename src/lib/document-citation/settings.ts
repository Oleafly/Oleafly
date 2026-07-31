const STORAGE_KEY = "oleafly.document-citation.settings.v1";

export interface DocumentCitationSettings {
  /** Minimum relevance score (0–100) to keep a candidate. Default 60. */
  scoreThreshold: number;
  /** Cap on results retained per literature source. Default 8. */
  maxResultsPerSource: number;
  /** Cap on results retained per paragraph. Default 5. */
  maxResultsPerParagraph: number;
  /** Cap on paragraphs scanned in one document pass. Default 20. */
  maxParagraphs: number;
}

export const DEFAULT_DOCUMENT_CITATION_SETTINGS: DocumentCitationSettings = {
  scoreThreshold: 60,
  maxResultsPerSource: 8,
  maxResultsPerParagraph: 5,
  maxParagraphs: 20,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampSettings(raw: Partial<DocumentCitationSettings>): DocumentCitationSettings {
  const base = { ...DEFAULT_DOCUMENT_CITATION_SETTINGS };
  if (typeof raw.scoreThreshold === "number" && Number.isFinite(raw.scoreThreshold)) {
    base.scoreThreshold = clamp(Math.round(raw.scoreThreshold), 0, 100);
  }
  if (
    typeof raw.maxResultsPerSource === "number" &&
    Number.isFinite(raw.maxResultsPerSource)
  ) {
    base.maxResultsPerSource = clamp(Math.round(raw.maxResultsPerSource), 1, 25);
  }
  if (
    typeof raw.maxResultsPerParagraph === "number" &&
    Number.isFinite(raw.maxResultsPerParagraph)
  ) {
    base.maxResultsPerParagraph = clamp(Math.round(raw.maxResultsPerParagraph), 1, 20);
  }
  if (typeof raw.maxParagraphs === "number" && Number.isFinite(raw.maxParagraphs)) {
    base.maxParagraphs = clamp(Math.round(raw.maxParagraphs), 1, 40);
  }
  return base;
}

export function loadDocumentCitationSettings(): DocumentCitationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DOCUMENT_CITATION_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<DocumentCitationSettings>;
    return clampSettings(parsed);
  } catch {
    return { ...DEFAULT_DOCUMENT_CITATION_SETTINGS };
  }
}

export function saveDocumentCitationSettings(
  partial: Partial<DocumentCitationSettings>,
): DocumentCitationSettings {
  const next = clampSettings({ ...loadDocumentCitationSettings(), ...partial });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

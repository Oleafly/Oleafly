export type DetectedInput = { kind: "doi" | "arxiv" | "title"; value: string };

/**
 * Classify a citation input: a DOI (bare or in a URL), an arXiv id (bare or in a
 * URL, version stripped), or free text to search by title.
 */
export function detectInput(raw: string): DetectedInput {
  const s = raw.trim();

  const doi = s.match(/10\.\d{4,9}\/[^\s"<>]+/);
  if (doi) return { kind: "doi", value: doi[0].replace(/[.,;:]+$/, "") };

  const url = s.match(/arxiv\.org\/(?:abs|pdf)\/([\w./-]+?)(?:v\d+)?(?:\.pdf)?$/i);
  if (url) return { kind: "arxiv", value: url[1] };

  const modern = s.match(/^(?:arxiv:)?\s*(\d{4}\.\d{4,5})(?:v\d+)?$/i);
  if (modern) return { kind: "arxiv", value: modern[1] };

  const old = s.match(/^(?:arxiv:)?\s*([a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i);
  if (old) return { kind: "arxiv", value: old[1] };

  return { kind: "title", value: s };
}

export type DetectedInput = {
  kind: "doi" | "arxiv" | "isbn" | "pmid" | "title";
  value: string;
};

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

  // ISBN-10/13, with spaces or hyphens ("isbn:" prefix optional). A 13-digit
  // form must start 978/979; a 10-digit form may end in X.
  const isbnCandidate = s.replace(/^[Ii][Ss][Bb][Nn]\s*:\s*/, "").replace(/[- ]/g, "");
  if (
    /^\d{13}$/.test(isbnCandidate) && /^(978|979)/.test(isbnCandidate)
  ) {
    return { kind: "isbn", value: isbnCandidate };
  }
  if (/^\d{9}[\dX]$/.test(isbnCandidate)) {
    return { kind: "isbn", value: isbnCandidate };
  }

  // Bare integers in the modern PMID range are PubMed ids ("PMID:" optional).
  const pmid = s.match(/^(?:pmid:)?\s*(\d{6,9})$/i);
  if (pmid) return { kind: "pmid", value: pmid[1] };

  return { kind: "title", value: s };
}

export type DetectedInput = {
  kind: "doi" | "arxiv" | "isbn" | "pmid" | "title";
  value: string;
};

export function detectInput(raw: string): DetectedInput {
  const s = raw.trim();

  const doi = /10\.\d{4,9}\/[^\s"<>]+/.exec(s);
  if (doi) return { kind: "doi", value: doi[0].replace(/(?<![.,;:])[.,;:]+$/, "") };

  const url = /arxiv\.org\/(?:abs|pdf)\/([\w./-]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(s);
  if (url) return { kind: "arxiv", value: url[1] };

  const modern = /^(?:arxiv:)?\s*(\d{4}\.\d{4,5})(?:v\d+)?$/i.exec(s);
  if (modern) return { kind: "arxiv", value: modern[1] };

  const old = /^(?:arxiv:)?\s*([a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i.exec(s);
  if (old) return { kind: "arxiv", value: old[1] };

  // ISBN-10/13, with spaces or hyphens ("isbn:" prefix optional). A 13-digit
  // form must start 978/979; a 10-digit form may end in X.
  const isbnCandidate = s.replace(/^isbn(?:-1[03])?\s*:\s*/i, "").replace(/[- ]/g, "").toUpperCase();
  if (
    /^\d{13}$/.test(isbnCandidate) && /^(978|979)/.test(isbnCandidate)
  ) {
    return { kind: "isbn", value: isbnCandidate };
  }
  if (/^\d{9}[\dX]$/.test(isbnCandidate)) {
    return { kind: "isbn", value: isbnCandidate };
  }

  // Bare integers in the modern PMID range are PubMed ids ("PMID:" optional).
  const explicitPmid = s.match(/^pmid:\s*([1-9]\d{0,8})$/i)
    ?? s.match(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/([1-9]\d{0,8})\/?(?:[?#].*)?$/i);
  if (explicitPmid) return { kind: "pmid", value: explicitPmid[1] };
  const pmid = s.match(/^([1-9]\d{5,8})$/);
  if (pmid) return { kind: "pmid", value: pmid[1] };

  return { kind: "title", value: s };
}

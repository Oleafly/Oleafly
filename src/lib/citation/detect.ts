export type DetectedInput = { kind: "doi" | "arxiv" | "title"; value: string };

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

  return { kind: "title", value: s };
}

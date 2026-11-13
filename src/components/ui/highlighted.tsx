export interface HighlightPart {
  text: string;
  start: number;
  match: boolean;
}

export function highlightParts(text: string, ranges: readonly (readonly [number, number])[]): HighlightPart[] {
  const sorted = ranges
    .map(([start, end]) => [Math.max(0, start), Math.min(text.length, end)] as const)
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  const parts: HighlightPart[] = [];
  let at = 0;
  for (const [start, end] of sorted) {
    if (end <= at) continue;
    const from = Math.max(start, at);
    if (from > at) parts.push({ text: text.slice(at, from), start: at, match: false });
    parts.push({ text: text.slice(from, end), start: from, match: true });
    at = end;
  }
  if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at), start: at, match: false });
  return parts;
}

export function Highlighted({ text, ranges }: Readonly<{ text: string; ranges: readonly (readonly [number, number])[] }>) {
  return (
    <>
      {highlightParts(text, ranges).map((part) =>
        part.match ? (
          <mark key={part.start} className="rounded-sm bg-primary/15 px-px text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={part.start}>{part.text}</span>
        ),
      )}
    </>
  );
}

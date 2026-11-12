import { useTranslation } from "react-i18next";
import { Highlighted } from "@/components/ui/highlighted";
import { useNow } from "@/hooks/use-now";
import { FieldChip } from "./FieldChip";
import { fieldDisplay, inlineFields } from "./note-fields";

type Range = readonly [number, number];

const NO_RANGES: readonly Range[] = [];

function within(ranges: readonly Range[], from: number, to: number): Range[] {
  return ranges.flatMap(([start, end]) => (end > from && start < to ? [[Math.max(start, from) - from, Math.min(end, to) - from] as const] : []));
}

export function NoteSnippet({ text, ranges = NO_RANGES }: Readonly<{ text: string; ranges?: readonly Range[] }>) {
  const { i18n } = useTranslation();
  const now = useNow(60_000);
  const fields = inlineFields(text);
  if (fields.length === 0) return <Highlighted text={text} ranges={ranges} />;
  const parts = [];
  let at = 0;
  for (const field of fields) {
    if (field.from > at) parts.push(<Highlighted key={`t${at}`} text={text.slice(at, field.from)} ranges={within(ranges, at, field.from)} />);
    parts.push(
      <FieldChip
        key={`f${field.from}`}
        display={fieldDisplay(field, new Date(now), i18n.language)}
        inline
        match={within(ranges, field.from, field.to).length > 0}
      />,
    );
    at = field.to;
  }
  if (at < text.length) parts.push(<Highlighted key={`t${at}`} text={text.slice(at)} ranges={within(ranges, at, text.length)} />);
  return <>{parts}</>;
}

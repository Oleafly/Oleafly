import type { Mapping } from "@tiptap/pm/transform";

interface Range {
  from: number;
  to: number;
}

export const MAX_LOCAL_EDITS = 200;

function joined(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((left, right) => left.from - right.from || left.to - right.to);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}

function capped(ranges: Range[]): Range[] {
  while (ranges.length > MAX_LOCAL_EDITS) {
    let closest = 0;
    for (let index = 1; index < ranges.length - 1; index += 1) {
      if (ranges[index + 1].from - ranges[index].to < ranges[closest + 1].from - ranges[closest].to) closest = index;
    }
    ranges.splice(closest, 2, { from: ranges[closest].from, to: ranges[closest + 1].to });
  }
  return ranges;
}

export class LocalEdits {
  private ranges: Range[] = [];

  record(mapping: Mapping): void {
    const next = this.ranges.map((range) => ({ from: mapping.map(range.from, -1), to: mapping.map(range.to, 1) }));
    mapping.maps.forEach((map, index) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        let from = newStart;
        let to = newEnd;
        for (const later of mapping.maps.slice(index + 1)) {
          from = later.map(from, -1);
          to = later.map(to, 1);
        }
        next.push({ from, to });
      });
    });
    this.ranges = capped(joined(next));
  }

  overlaps(from: number, to: number): boolean {
    return this.ranges.some((range) => from <= range.to && range.from <= to);
  }

  get dirty(): boolean {
    return this.ranges.length > 0;
  }

  get count(): number {
    return this.ranges.length;
  }

  clear(): void {
    this.ranges = [];
  }
}

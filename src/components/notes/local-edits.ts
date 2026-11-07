import type { Mapping } from "@tiptap/pm/transform";

interface Range {
  from: number;
  to: number;
}

export class LocalEdits {
  private ranges: Range[] = [];

  record(mapping: Mapping): void {
    this.ranges = this.ranges.map((range) => ({ from: mapping.map(range.from, -1), to: mapping.map(range.to, 1) }));
    mapping.maps.forEach((map, index) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        let from = newStart;
        let to = newEnd;
        for (const later of mapping.maps.slice(index + 1)) {
          from = later.map(from, -1);
          to = later.map(to, 1);
        }
        this.ranges.push({ from, to });
      });
    });
  }

  overlaps(from: number, to: number): boolean {
    return this.ranges.some((range) => from <= range.to && range.from <= to);
  }

  get dirty(): boolean {
    return this.ranges.length > 0;
  }

  clear(): void {
    this.ranges = [];
  }
}

export type DiffRow = {
  kind: "meta" | "hunk" | "context" | "del" | "add";
  text: string;
  oldLine?: number;
  newLine?: number;
};

export function parseDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(raw);
      if (m) {
        oldLine = +m[1];
        newLine = +m[2];
      }
      rows.push({ kind: "hunk", text: raw });
    } else if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("---") ||
      raw.startsWith("+++") ||
      raw.startsWith("\\")
    ) {
      rows.push({ kind: "meta", text: raw });
    } else if (raw.startsWith("-")) {
      rows.push({ kind: "del", text: raw.slice(1), oldLine: oldLine++ });
    } else if (raw.startsWith("+")) {
      rows.push({ kind: "add", text: raw.slice(1), newLine: newLine++ });
    } else {
      rows.push({
        kind: "context",
        text: raw.replace(/^ /, ""),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }
  return rows;
}

export function toSplitPairs(rows: DiffRow[]) {
  const out: { l?: DiffRow; r?: DiffRow }[] = [];
  let dels: DiffRow[] = [];
  let adds: DiffRow[] = [];
  const flush = () => {
    const max = Math.max(dels.length, adds.length);
    for (let k = 0; k < max; k++) out.push({ l: dels[k], r: adds[k] });
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.kind === "meta") continue;
    if (r.kind === "hunk") {
      flush();
      out.push({ l: r, r: r });
      continue;
    }
    if (r.kind === "context") {
      flush();
      out.push({ l: r, r: r });
      continue;
    }
    if (r.kind === "del") dels.push(r);
    else if (r.kind === "add") adds.push(r);
  }
  flush();
  return out;
}

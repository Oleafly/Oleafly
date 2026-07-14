// `\DocumentMetadata` must be the literal first line of the source (before
// `\documentclass`) for LuaLaTeX tagging to pick it up; tagging/pdfstandard
// keys and `unicode-math` are otherwise silently not applied.

export interface PrepChange {
  kind: "add" | "modify" | "warn" | "info";
  summary: string;
}

export interface PrepResult {
  output: string;
  changes: PrepChange[];
}

const REQUIRED_META: Record<string, string> = { pdfstandard: "ua-2", tagging: "on" };

function parseKeys(body: string): { order: string[]; map: Map<string, string> } {
  const order: string[] = [];
  const map = new Map<string, string>();
  for (const part of body.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) {
      if (!map.has(k)) order.push(k);
      map.set(k, v);
    }
  }
  return { order, map };
}

function serializeKeys(order: string[], map: Map<string, string>): string {
  return order.map((k) => `${k}=${map.get(k)}`).join(",");
}

export function prepareAccessibleSource(source: string, opts?: { lang?: string }): PrepResult {
  const lang = opts?.lang ?? "en-US";
  const changes: PrepChange[] = [];
  let out = source;

  const metaRe = /\\DocumentMetadata\s*\{([^}]*)\}/;
  const existing = metaRe.exec(out);
  if (existing) {
    const { order, map } = parseKeys(existing[1]);
    let touched = false;
    if (!map.has("lang")) {
      order.push("lang");
      map.set("lang", lang);
      touched = true;
    }
    for (const [k, v] of Object.entries(REQUIRED_META)) {
      if (!map.has(k)) {
        order.push(k);
        map.set(k, v);
        touched = true;
      }
    }
    if (touched) {
      out = out.replace(metaRe, `\\DocumentMetadata{${serializeKeys(order, map)}}`);
      changes.push({ kind: "modify", summary: "Added the required tagging keys to your \\DocumentMetadata." });
    }
  } else {
    out = `\\DocumentMetadata{lang=${lang},pdfstandard=ua-2,tagging=on}\n${out}`;
    changes.push({ kind: "add", summary: "Added \\DocumentMetadata as the first line (required, must precede \\documentclass)." });
  }

  const hasUnicodeMath = /\\usepackage(?:\[[^\]]*\])?\{unicode-math\}/.test(out);
  const dc = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/.exec(out);
  if (!hasUnicodeMath && dc) {
    const insertAt = dc.index + dc[0].length;
    out = `${out.slice(0, insertAt)}\n\\usepackage{unicode-math}${out.slice(insertAt)}`;
    changes.push({ kind: "add", summary: "Added \\usepackage{unicode-math} (required for tagged output)." });
  }

  let altAdded = 0;
  out = out.replace(/\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g, (whole, optsGroup, file) => {
    const o = optsGroup ?? "";
    if (/\balt\s*=/.test(o)) return whole;
    altAdded++;
    const stub = `alt={TODO: describe ${file.trim()}}`;
    return o ? `\\includegraphics[${stub},${o}]{${file}}` : `\\includegraphics[${stub}]{${file}}`;
  });
  if (altAdded > 0) {
    changes.push({
      kind: "modify",
      summary: `Added alt-text placeholders to ${altAdded} image${altAdded > 1 ? "s" : ""}. Replace the TODO text with a real description.`,
    });
  }

  if (/\\usepackage(?:\[[^\]]*\])?\{listings\}/.test(out) || /\\begin\{lstlisting\}/.test(out)) {
    changes.push({
      kind: "warn",
      summary: "The listings package is not compatible with tagging. Replace code listings, or expect tagging errors.",
    });
  }

  changes.push({
    kind: "info",
    summary: "Tagged export needs LuaLaTeX with TeX Live 2025 or newer and OpenType fonts. Run the prepared source through that engine, then re-check the output.",
  });

  return { output: out, changes };
}

export interface TypstNotesQuery {
  readonly located: boolean;
  readonly notes: readonly unknown[];
  readonly files: readonly unknown[];
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function contentToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(contentToText).join("");
  if (!isRecord(value)) return "";
  switch (value.func) {
    case "space":
      return " ";
    case "linebreak":
      return "\n";
    case "parbreak":
      return "\n\n";
    case "smartquote":
      return value.double === false ? "'" : '"';
    default:
      if (typeof value.text === "string") return value.text;
      if (Array.isArray(value.children)) return value.children.map(contentToText).join("");
      if ("body" in value) return contentToText(value.body);
      return "";
  }
}

export function notesFromPdfpcFile(value: unknown): Map<number, string> {
  const notes = new Map<number, string>();
  if (!isRecord(value) || !Array.isArray(value.pages)) return notes;
  const byLabel = new Map<string, string>();
  for (const page of value.pages) {
    if (!isRecord(page) || typeof page.idx !== "number" || page.idx < 0) continue;
    const label = typeof page.label === "string" ? page.label : null;
    const own = typeof page.note === "string" ? page.note.trim() : "";
    if (own && label) byLabel.set(label, own);
    const text = own || (label ? (byLabel.get(label) ?? "") : "");
    if (text) notes.set(page.idx + 1, text);
  }
  return notes;
}

function legacyNotes(text: string): Map<number, string> {
  const notes = new Map<number, string>();
  let inNotes = false;
  let page: number | null = null;
  let lines: string[] = [];
  const flush = () => {
    const note = lines.join("\n").trim();
    if (page !== null && note) notes.set(page, note);
    lines = [];
  };
  for (const line of text.split(/\r?\n/u)) {
    const section = /^\[([^\]]+)\]\s*$/u.exec(line);
    if (section) {
      flush();
      page = null;
      inNotes = section[1] === "notes";
      continue;
    }
    if (!inNotes) continue;
    const header = /^###\s*(\d+)\s*$/u.exec(line);
    if (header) {
      flush();
      page = Number(header[1]);
      continue;
    }
    lines.push(line);
  }
  flush();
  return notes;
}

export function parsePdfpcText(text: string): Map<number, string> {
  const trimmed = text.trim();
  if (!trimmed) return new Map();
  if (trimmed.startsWith("{")) {
    try {
      return notesFromPdfpcFile(JSON.parse(trimmed));
    } catch {
      return new Map();
    }
  }
  return legacyNotes(trimmed);
}

function noteText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  if (value.t === "Note") return contentToText(value.v);
  if ("notes" in value) return contentToText(value.notes);
  if ("note" in value) return contentToText(value.note);
  return null;
}

function explicitPage(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const page = value.page ?? value.slide;
  return typeof page === "number" && Number.isInteger(page) && page > 0 ? page : null;
}

function joinNotes(collected: ReadonlyMap<number, string[]>): Map<number, string> {
  const notes = new Map<number, string>();
  for (const [page, texts] of [...collected.entries()].sort(([left], [right]) => left - right)) {
    notes.set(page, texts.join("\n\n"));
  }
  return notes;
}

export function notesFromTypstQuery(result: TypstNotesQuery): Map<number, string> {
  for (const file of result.files) {
    const fromFile = notesFromPdfpcFile(file);
    if (fromFile.size > 0) return fromFile;
  }
  const collected = new Map<number, string[]>();
  const add = (page: number | null, text: string | null) => {
    const trimmed = text?.trim();
    if (!page || page < 1 || !trimmed) return;
    collected.set(page, [...(collected.get(page) ?? []), trimmed]);
  };
  if (result.located) {
    for (const entry of result.notes) {
      if (!isRecord(entry)) continue;
      const page = typeof entry.page === "number" ? entry.page : null;
      add(explicitPage(entry.value) ?? page, noteText(entry.value));
    }
    return joinNotes(collected);
  }
  let current: number | null = null;
  let sequential = 0;
  for (const value of result.notes) {
    if (isRecord(value) && value.t === "Idx" && typeof value.v === "number") {
      current = value.v + 1;
      continue;
    }
    const text = noteText(value);
    if (text === null) continue;
    const explicit = explicitPage(value);
    if (explicit !== null) {
      add(explicit, text);
      continue;
    }
    if (current === null) sequential += 1;
    add(current ?? sequential, text);
  }
  return joinNotes(collected);
}

export function pdfpcPathFor(path: string): string {
  return `${path.replace(/\.[^./]+$/u, "")}.pdfpc`;
}

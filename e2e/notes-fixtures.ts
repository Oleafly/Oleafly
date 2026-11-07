import type { NoteEdit } from "/src/components/notes/note-edits";
import { newNoteSource, readNoteFacts } from "/src/components/notes/note-file";
import type { NotesData } from "/src/components/notes/notes-data";
import {
  NoteConflictError,
  type ArtifactItem,
  type EditRequest,
  type ExperimentItem,
  type NoteItem,
  type NoteSource,
  type ResearchActionId,
} from "/src/components/notes/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FENCE = "```";

export const RUN_CHART_SOURCE = JSON.stringify(
  {
    title: "Validation by run",
    description: "Accuracy at three points in training.",
    unit: "%",
    categories: ["Run 1", "Run 2", "Run 3"],
    series: [
      { name: "Epoch 40", values: [52, 53, 54] },
      { name: "Epoch 80", values: [58, 60, 61] },
      { name: "Epoch 120", values: [61.2, 63, 64.1] },
    ],
    note: "Run 3 used a mask ratio of 0.60. Runs 1 and 2 used 0.75.",
  },
  null,
  2,
);

const LATEX_SAMPLE = String.raw`\begin{align}
L &= \frac{1}{|M|}\sum_{i \in M} (x_i - \hat{x}_i)^2 \\
M &\subset \{1, \dots, N\}
\end{align}`;

const MASKING_BODY = String.raw`## Where things stand

The encoder trains on patches with a mask ratio of 0.75. The first run reached 61.2% on validation, and run 3 reached 64.1%.

Masks are sampled per pixel. The decoder sees mask tokens at the same ratio.

## Data flow

${FENCE}mermaid
flowchart LR
  A[Patches] --> B[Random mask]
  B --> C[Encoder]
  C --> D[Decoder]
  D --> E[Reconstruction loss]
${FENCE}

## Loss

The loss is $L = \frac{1}{N}\sum_i (x_i - \hat{x}_i)^2$ on masked patches only.

## Runs

| Run | Mask ratio | Validation |
| --- | --- | --- |
| 1 | 0.75 | 61.2% |
| 2 | 0.75 | 63.0% |
| 3 | 0.60 | 64.1% |

## Validation by run

${FENCE}chart
${RUN_CHART_SOURCE}
${FENCE}

## Math in both languages

${FENCE}{=latex}
${LATEX_SAMPLE}
${FENCE}

${FENCE}{=typst}
$ "mask ratio" = 1 - (|K|) / N $
${FENCE}

## Sampling code

${FENCE}python
def sample_mask(patches, ratio):
    keep = int(len(patches) * (1 - ratio))
    return random.sample(range(len(patches)), keep)
${FENCE}

## Open questions

- Does a lower ratio still help on the smaller dataset?
- Should the decoder share the positional embedding?
`;

const LOSS_CURVE = [
  [52, 56, 58, 60, 61, 61.2],
  [52, 57, 60, 62, 62.8, 63],
  [53, 58, 61, 63, 63.9, 64.1],
];

function lossCurveSvg(): string {
  const lines = LOSS_CURVE.map((values, index) => {
    const points = values.map((value, step) => `${40 + step * 72},${170 - (value - 50) * 10}`).join(" ");
    return `<polyline fill="none" stroke="#2563eb" stroke-width="2" stroke-opacity="${[0.4, 0.65, 1][index]}" points="${points}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 200"><line x1="40" y1="170" x2="410" y2="170" stroke="#d4d4d8"/><line x1="40" y1="20" x2="40" y2="170" stroke="#d4d4d8"/>${lines}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface StoredNote {
  meta: Omit<NoteItem, "icon" | "summary" | "author" | "agent">;
  text: string;
  version: number;
}

export interface NotesFixture {
  snapshot(): NotesData;
  subscribe(listener: () => void): () => void;
  writeFromDisk(id: string, text: string): void;
  text(id: string): string;
}

function stored(id: string, title: string, project: string, updatedAt: number, text: string): [string, StoredNote] {
  return [id, { meta: { id, title, project, updatedAt }, text, version: 1 }];
}

export function createNotesFixture(now = Date.now(), delay = EDIT_DELAY_MS): NotesFixture {
  const notes = new Map<string, StoredNote>([
    stored(
      "masking",
      "Masking strategy report",
      "SSL masking",
      now - 2 * HOUR,
      `---\ntitle: Masking strategy report\nicon: 🧪\nagent: Claude Code\n---\n\n${MASKING_BODY}`,
    ),
    stored(
      "abstract",
      "Abstract draft",
      "SSL masking",
      now - DAY,
      "---\ntitle: Abstract draft\n---\n\nWe study how the mask ratio changes what a self-supervised encoder learns on small datasets. Lower ratios help up to a point.\n",
    ),
    stored(
      "reading",
      "Reading notes: masked autoencoders",
      "Literature",
      now - 10 * DAY,
      "---\ntitle: \"Reading notes: masked autoencoders\"\nicon: lucide:book-open\n---\n\n## Key claims\n\n- High mask ratios force the encoder to learn structure.\n- Asymmetric decoders keep training cheap.\n",
    ),
    stored(
      "dataloader",
      "Dataloader rewrite: what changed",
      "Training pipeline",
      now - 12 * DAY,
      "---\ntitle: \"Dataloader rewrite: what changed\"\nagent: Codex\n---\n\n## What changed\n\nThe loader now streams shards and shuffles inside a window of 4,096 samples.\n",
    ),
  ]);
  const listeners = new Set<() => void>();
  const watchers = new Map<string, Set<() => void>>();
  let created = 0;
  let current: NotesData | null = null;

  const changed = () => {
    current = null;
    for (const listener of listeners) listener();
  };
  const sourceOf = (note: StoredNote): NoteSource => ({ text: note.text, version: `v${note.version}` });
  const noteOf = (id: string) => {
    const note = notes.get(id);
    if (!note) throw new Error(`No note ${id}`);
    return note;
  };
  const items = (): NoteItem[] =>
    [...notes.values()].map((note) => {
      const facts = readNoteFacts(note.text);
      return {
        ...note.meta,
        author: facts.agent ? "agent" : "you",
        agent: facts.agent,
        icon: facts.icon,
        summary: facts.summary,
      };
    });

  const service = {
    proposeEdits: (request: EditRequest, signal: AbortSignal) => cannedEdits(request, signal, delay),
    loadNote: (id: string) => Promise.resolve(sourceOf(noteOf(id))),
    saveNote: (id: string, text: string, version: string) => {
      const note = noteOf(id);
      if (version !== `v${note.version}`) return Promise.reject(new NoteConflictError(sourceOf(note)));
      note.text = text;
      note.version += 1;
      changed();
      return Promise.resolve(sourceOf(note));
    },
    renameNote: (id: string, title: string) => {
      noteOf(id).meta.title = title;
      changed();
      return Promise.resolve();
    },
    createNote: () => {
      created += 1;
      const id = `new-${created}`;
      notes.set(id, { meta: { id, title: "Untitled", project: "Notes", updatedAt: Date.now() }, text: newNoteSource("Untitled"), version: 1 });
      changed();
      return Promise.resolve(id);
    },
    watchNote: (id: string, onChange: () => void) => {
      const set = watchers.get(id) ?? new Set();
      set.add(onChange);
      watchers.set(id, set);
      return () => set.delete(onChange);
    },
  } satisfies Partial<NotesData>;

  const build = (): NotesData => ({
    notes: items(),
    artifacts,
    experiments,
    agents: ["Claude Code", "Codex", "OpenCode", "Gemini CLI"],
    citations: [
      { key: "he2022mae", label: "He et al. 2022, Masked autoencoders" },
      { key: "chen2020simclr", label: "Chen et al. 2020, SimCLR" },
      { key: "grill2020byol", label: "Grill et al. 2020, BYOL" },
    ],
    papers: [
      { id: "ssl-paper", label: "ssl-masking-paper (LaTeX)" },
      { id: "thesis", label: "thesis-chapter-3 (Typst)" },
    ],
    ...service,
  });

  const artifacts: ArtifactItem[] = [
    {
      id: "loss-curve",
      title: "Validation curve, runs 1 to 3",
      kind: "figure",
      project: "SSL masking",
      noteIds: ["masking"],
      updatedAt: now - 2 * HOUR,
      author: "agent",
      agent: "Claude Code",
      chat: "Review run 3",
      summary: "SVG figure the agent wrote from the run logs.",
      preview: { type: "image", src: lossCurveSvg() },
      snippet: `${FENCE}chart\n${RUN_CHART_SOURCE}\n${FENCE}\n`,
    },
    {
      id: "run-3",
      title: "Run 3, mask ratio 0.60",
      kind: "run",
      project: "SSL masking",
      noteIds: ["masking"],
      updatedAt: now - 3 * HOUR,
      author: "agent",
      agent: "Claude Code",
      chat: "Review run 3",
      summary: "Finished in 4 h 12 min on two GPUs.",
      preview: {
        type: "metrics",
        metrics: [
          { label: "Validation", value: "64.1%" },
          { label: "Train loss", value: "0.214" },
          { label: "Epochs", value: "120" },
          { label: "Commit", value: "a41f9c2" },
        ],
      },
    },
    {
      id: "mask-sampler",
      title: "Mask sampler explorer",
      kind: "html",
      project: "SSL masking",
      noteIds: ["masking"],
      updatedAt: now - DAY,
      author: "agent",
      agent: "Claude Code",
      chat: "Explain the mask sampler",
      summary: "Interactive HTML figure.",
    },
    {
      id: "weekly",
      title: "Weekly progress report",
      kind: "report",
      project: "SSL masking",
      noteIds: ["masking"],
      updatedAt: now - DAY,
      author: "agent",
      agent: "Codex",
      chat: "Write the weekly report",
      summary: "Three runs finished, one regression fixed, two questions open.",
      preview: {
        type: "text",
        heading: "Week of Nov 2",
        body: "Three runs finished. Validation went from 61.2% to 64.1%. One dataloader regression was fixed, and two questions are still open.",
      },
    },
  ];

  const experiments: ExperimentItem[] = [
    { project: "SSL masking", runs: 3, figures: 4, reports: 2, updatedAt: now - 2 * HOUR, noteId: "masking" },
    { project: "Training pipeline", runs: 1, figures: 1, reports: 1, updatedAt: now - 12 * DAY, noteId: "dataloader" },
  ];

  return {
    snapshot: () => {
      current ??= build();
      return current;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    writeFromDisk: (id, text) => {
      const note = noteOf(id);
      note.text = text;
      note.version += 1;
      changed();
      for (const watcher of watchers.get(id) ?? []) watcher();
    },
    text: (id) => noteOf(id).text,
  };
}

const RATIO: NoteEdit = { find: "mask ratio of 0.75. The first run", replace: "mask ratio of 0.60. The first run" };
const RUN: NoteEdit = { find: "and run 3 reached 64.1%.", replace: "and run 3 reached 64.1% after the ratio dropped to 0.60." };
const PATCH: NoteEdit = { find: "Masks are sampled per pixel.", replace: "Masks are sampled per patch, not per pixel." };
const CITE: NoteEdit = { find: "and run 3 reached 64.1%.", replace: "and run 3 reached 64.1% [@he2022mae]." };
const PARAGRAPH: NoteEdit = {
  find: "The decoder sees mask tokens at the same ratio.",
  replace:
    "The decoder sees mask tokens at the same ratio.\n\nRun 3 is the first run with the lower ratio, so the encoder sees more patches. Nothing else changed from run 2, which makes the 1.1 point gain easy to attribute.",
};

const ACTION_EDITS: Record<ResearchActionId, readonly NoteEdit[]> = {
  latestRun: [RATIO, RUN],
  claims: [PATCH],
  citations: [CITE],
  proofread: [PATCH],
  rewrite: [PATCH, RUN],
  shorter: [PATCH],
  paragraph: [PARAGRAPH],
  table: [PARAGRAPH],
  figure: [PARAGRAPH],
  abstract: [PARAGRAPH],
};

export const EDIT_DELAY_MS = 400;

function cannedEdits(request: EditRequest, signal: AbortSignal, delay: number): Promise<readonly NoteEdit[]> {
  const edits = request.noteId === "masking" ? (request.actionId ? ACTION_EDITS[request.actionId] : [RATIO, PATCH]) : [];
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(edits), delay);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

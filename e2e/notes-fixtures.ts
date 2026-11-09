import { newNoteSource, readNoteFacts } from "/src/components/notes/note-file";
import { notePreviewSource } from "/src/components/notes/note-preview-source";
import { linkTargets } from "/src/components/notes/note-link-format";
import type { NotesData } from "/src/components/notes/notes-data";
import {
  NoteConflictError,
  type ArtifactItem,
  type ArtifactPreview,
  type ExperimentItem,
  type NoteItem,
  type NoteSource,
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

const ESC = String.fromCharCode(27);
const SWEEP_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAANUlEQVR42mNQTX4NQbdf/YMg8kQYqGIKkM1AFVNABlHFFIRBlIcUA1VMQQT2aKyNxtowizUAJdworl0zDhQAAAAASUVORK5CYII=";

export const SWEEP_NOTEBOOK = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: "python3", language: "python" }, language_info: { name: "python" } },
  cells: [
    { cell_type: "markdown", metadata: {}, source: ["# Mask ratio sweep\n", "\n", "Validation rises as the ratio drops to $0.60$."] },
    {
      cell_type: "code",
      execution_count: 1,
      metadata: {},
      source: ["ratios = [0.75, 0.60]\n", "plot(ratios)"],
      outputs: [{ output_type: "display_data", metadata: {}, data: { "image/png": SWEEP_PNG, "text/plain": "<Figure size 640x480>" } }],
    },
    {
      cell_type: "code",
      execution_count: 2,
      metadata: {},
      source: "print('best ratio:', best)",
      outputs: [{ output_type: "stream", name: "stdout", text: ["best ratio: 0.60\n"] }],
    },
    {
      cell_type: "code",
      execution_count: 3,
      metadata: {},
      source: "table",
      outputs: [
        {
          output_type: "execute_result",
          execution_count: 3,
          metadata: {},
          data: {
            "text/html": "<table><tr><th>ratio</th><th>validation</th></tr><tr><td>0.60</td><td>64.1</td></tr></table><script>parent.document.title = 'ran'</script>",
            "text/plain": "ratio validation",
          },
        },
      ],
    },
    {
      cell_type: "code",
      execution_count: 4,
      metadata: {},
      source: "1 / 0",
      outputs: [
        {
          output_type: "error",
          ename: "ZeroDivisionError",
          evalue: "division by zero",
          traceback: [`${ESC}[0;31m---------------------------------------------------------------------------${ESC}[0m`, `${ESC}[0;31mZeroDivisionError${ESC}[0m: division by zero`],
        },
      ],
    },
  ],
});

function notebookUrl(text: string): string {
  return `data:application/x-ipynb+json;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`;
}

export const IMPORTED_NOTEBOOK = "assets/sweep-1a2b3c4d.ipynb";

const PREVIEWS: Readonly<Record<string, ArtifactPreview>> = {
  "figures/loss-curve.svg": { type: "image", src: lossCurveSvg() },
  "notebooks/mask-sweep.ipynb": { type: "notebook", text: SWEEP_NOTEBOOK },
  "runs/run-3/metrics.csv": {
    type: "table",
    rows: [
      ["metric", "value"],
      ["validation", "64.1%"],
      ["train loss", "0.214"],
      ["epochs", "120"],
    ],
    truncated: false,
  },
  "figures/mask-sampler.html": { type: "none", reason: "html" },
  "reports/weekly.md": {
    type: "text",
    text: "# Week of Nov 2\n\nThree runs finished. Validation went from 61.2% to 64.1%.",
    truncated: false,
  },
};

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
  has(id: string): boolean;
  settingsOpened(): number;
}

const PROJECTS = [
  { id: "ssl", name: "SSL masking" },
  { id: "pipeline", name: "Training pipeline" },
  { id: "literature", name: "Literature" },
  { id: "thesis", name: "Thesis" },
];

function stored(
  id: string,
  title: string,
  projectId: string,
  updatedAt: number,
  text: string,
  createdAt = updatedAt,
): [string, StoredNote] {
  const project = PROJECTS.find((candidate) => candidate.id === projectId)?.name ?? "Notes";
  return [id, { meta: { id, title, project, relatedProjectId: projectId, updatedAt, createdAt }, text, version: 1 }];
}

const NOTE_IDS = {
  masking: "8d3f2a61-4b7c-4e9d-a1f0-5c6b7d8e9f01",
  abstract: "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3e02",
  reading: "7a9c1e35-6d8f-4b2a-9e4c-0f1a2b3c4d03",
  dataloader: "4e6a8c02-3d5f-4a7b-b9c1-2e3f4a5b6c04",
} as const;

export const LATEST_RUN = "Task: Review run 3\nSummary:\nRun 3 used a mask ratio of 0.60 and reached 64.1% on validation.";

export function createNotesFixture(now = Date.now()): NotesFixture {
  const notes = new Map<string, StoredNote>([
    stored(
      "masking",
      "Masking strategy report",
      "ssl",
      now - 2 * HOUR,
      `---\ntitle: Masking strategy report\nicon: 🧪\nagent: Claude Code\nkind: note\nid: ${NOTE_IDS.masking}\n---\n\n${MASKING_BODY}`,
      now - 6 * DAY,
    ),
    stored(
      "abstract",
      "Abstract draft",
      "ssl",
      now - DAY,
      `---\ntitle: Abstract draft\nkind: note\nid: ${NOTE_IDS.abstract}\n---\n\nWe study how the mask ratio changes what a self-supervised encoder learns on small datasets. Lower ratios help up to a point.\n\n## Contributions\n\n- A sweep of mask ratios from 0.4 to 0.9 on three small datasets.\n- A schedule that lowers the ratio as training goes on.\n`,
      now - 3 * DAY,
    ),
    stored(
      "reading",
      "Reading notes: masked autoencoders",
      "literature",
      now - 10 * DAY,
      `---\ntitle: "Reading notes: masked autoencoders"\nicon: lucide:book-open\nkind: note\nid: ${NOTE_IDS.reading}\n---\n\n## Key claims\n\n- High mask ratios force the encoder to learn structure.\n- Asymmetric decoders keep training cheap.\n- Our ratio runs are in the [Masking strategy report](oleafly://note/${NOTE_IDS.masking}) for the [SSL masking](oleafly://project/ssl) project.\n\n## Papers\n\n| Paper | Year | Mask ratio |\n| --- | --- | --- |\n| MAE | 2022 | 0.75 |\n| SimMIM | 2022 | 0.60 |\n| BEiT | 2021 | 0.40 |\n`,
      now - 30 * DAY,
    ),
    stored(
      "dataloader",
      "Dataloader rewrite: what changed",
      "pipeline",
      now - 12 * DAY,
      `---\ntitle: "Dataloader rewrite: what changed"\nagent: Codex\nkind: note\nid: ${NOTE_IDS.dataloader}\n---\n\n## What changed\n\nThe loader now streams shards and shuffles inside a window of 4,096 samples.\n\nThe [SSL masking](oleafly://project/ssl) runs use it, and the [Masking strategy report](oleafly://note/${NOTE_IDS.masking}) has their numbers.\n\n![Throughput before and after the rewrite](assets/throughput.svg)\n\n- Shards are read four at a time.\n- Workers no longer copy samples between processes.\n`,
      now - 20 * DAY,
    ),
  ]);
  const listeners = new Set<() => void>();
  const watchers = new Map<string, Set<() => void>>();
  let created = 0;
  let settingsOpened = 0;
  let current: NotesData | null = null;
  const copies: { noteId: string; path: string }[] = [{ noteId: "dataloader", path: "assets/throughput.svg" }];

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
        color: facts.color,
        summary: facts.summary,
        preview: notePreviewSource(note.text, note.meta.title),
      };
    });

  const service = {
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
    deleteNote: (id: string) => {
      noteOf(id);
      notes.delete(id);
      watchers.delete(id);
      changed();
      return Promise.resolve();
    },
    openSettings: () => {
      settingsOpened += 1;
    },
    createNote: () => {
      created += 1;
      const id = `new-${created}`;
      notes.set(id, { meta: { id, title: "Untitled", project: "Notes", updatedAt: Date.now() }, text: newNoteSource("Untitled"), version: 1 });
      changed();
      return Promise.resolve(id);
    },
    setRelatedProject: (id: string, projectId: string | null) => {
      const meta = noteOf(id).meta;
      meta.relatedProjectId = projectId ?? undefined;
      meta.project = PROJECTS.find((project) => project.id === projectId)?.name ?? "Notes";
      changed();
      return Promise.resolve();
    },
    latestRun: (id: string) => (noteOf(id).meta.relatedProjectId === "ssl" ? LATEST_RUN : null),
    previewArtifact: (artifact: ArtifactItem) => {
      const preview = PREVIEWS[artifact.path];
      return preview ? Promise.resolve(preview) : Promise.reject(new Error("The saved task file is missing."));
    },
    copyArtifact: (noteId: string, artifact: ArtifactItem) => {
      const path = `assets/${artifact.path.split("/").pop() ?? artifact.path}`;
      if (!copies.some((copy) => copy.noteId === noteId && copy.path === path)) copies.push({ noteId, path });
      return Promise.resolve(path);
    },
    resolveAsset: (noteId: string, path: string) => {
      const copied = copies.some((copy) => copy.noteId === noteId && copy.path === path);
      if (copied && path.endsWith(".ipynb")) return Promise.resolve(notebookUrl(SWEEP_NOTEBOOK));
      return Promise.resolve(copied && path.endsWith(".svg") ? lossCurveSvg() : null);
    },
    importNotebook: (noteId: string) => {
      if (!copies.some((copy) => copy.noteId === noteId && copy.path === IMPORTED_NOTEBOOK)) {
        copies.push({ noteId, path: IMPORTED_NOTEBOOK });
      }
      return Promise.resolve(IMPORTED_NOTEBOOK);
    },
    watchNote: (id: string, onChange: () => void) => {
      const set = watchers.get(id) ?? new Set();
      set.add(onChange);
      watchers.set(id, set);
      return () => set.delete(onChange);
    },
    noteLinks: () =>
      Promise.resolve(
        [...notes.values()].map((note) => ({
          projectId: note.meta.id,
          noteId: readNoteFacts(note.text).id ?? null,
          title: note.meta.title,
          links: linkTargets(note.text),
        })),
      ),
  } satisfies Partial<NotesData>;

  const build = (): NotesData => ({
    notes: items(),
    artifacts,
    experiments,
    projects: PROJECTS,
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

  const artifact = (
    taskId: string,
    path: string,
    title: string,
    kind: ArtifactItem["kind"],
    updatedAt: number,
    agent: string,
    chat: string,
    summary: string,
  ): ArtifactItem => ({
    id: `${taskId}\n${path}`,
    taskId,
    path,
    title,
    kind,
    projectId: "ssl",
    project: "SSL masking",
    updatedAt,
    agent,
    chat,
    summary,
  });

  const artifacts: ArtifactItem[] = [
    artifact(
      "task-run3",
      "figures/loss-curve.svg",
      "Validation curve, runs 1 to 3",
      "figure",
      now - 2 * HOUR,
      "Claude Code",
      "Review run 3",
      "SVG figure the agent wrote from the run logs.",
    ),
    artifact(
      "task-run3",
      "runs/run-3/metrics.csv",
      "Run 3, mask ratio 0.60",
      "data",
      now - 2 * HOUR,
      "Claude Code",
      "Review run 3",
      "Finished in 4 h 12 min on two GPUs.",
    ),
    artifact(
      "task-sampler",
      "figures/mask-sampler.html",
      "Mask sampler explorer",
      "html",
      now - DAY,
      "Claude Code",
      "Explain the mask sampler",
      "Interactive HTML figure.",
    ),
    artifact(
      "task-weekly",
      "reports/weekly.md",
      "Weekly progress report",
      "report",
      now - DAY,
      "Codex",
      "Write the weekly report",
      "Three runs finished, one regression fixed, two questions open.",
    ),
    {
      ...artifact(
        "task-sweep",
        "notebooks/mask-sweep.ipynb",
        "Mask ratio sweep",
        "notebook",
        now - 13 * DAY,
        "Codex",
        "Sweep the mask ratio",
        "Notebook with the sweep, its plot and one failed cell.",
      ),
      projectId: "pipeline",
      project: "Training pipeline",
    },
  ];

  const experiments: ExperimentItem[] = [
    { projectId: "ssl", project: "SSL masking", tasks: 3, figures: 2, reports: 2, updatedAt: now - 2 * HOUR, noteId: "masking" },
    {
      projectId: "pipeline",
      project: "Training pipeline",
      tasks: 1,
      figures: 0,
      reports: 1,
      updatedAt: now - 12 * DAY,
      noteId: "dataloader",
    },
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
    has: (id) => notes.has(id),
    settingsOpened: () => settingsOpened,
  };
}

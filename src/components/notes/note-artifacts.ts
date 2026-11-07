import type { ResearchTask, TaskArtifact, TaskPreviewContent } from "@/lib/research-tasks";
import type { ArtifactItem, ArtifactKind, ArtifactPreview, ExperimentItem, NoteItem } from "./types";

const FIGURE = /\.(png|jpe?g|gif|webp|svg|pdf)$/iu;
const DATA = /\.(csv|tsv|json|jsonl|parquet|npy|npz|h5|hdf5|xlsx?)$/iu;
const REPORT = /\.(md|markdown|txt|tex|typ|log|rst)$/iu;
const HTML = /\.html?$/iu;
const TABLE_ROWS = 12;
const TABLE_COLUMNS = 8;
const TEXT_CHARS = 4000;
const RUN_SUMMARY_CHARS = 6000;

export function artifactKind(artifact: Pick<TaskArtifact, "path" | "mediaType">): ArtifactKind {
  const { path, mediaType } = artifact;
  if (HTML.test(path) || mediaType === "text/html") return "html";
  if (FIGURE.test(path) || mediaType?.startsWith("image/")) return "figure";
  if (DATA.test(path) || mediaType === "text/csv" || mediaType === "application/json") return "data";
  if (REPORT.test(path) || mediaType?.startsWith("text/")) return "report";
  return "file";
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function artifactId(taskId: string, path: string): string {
  return `${taskId}\n${path}`;
}

function finishedAt(task: ResearchTask): number {
  return task.finishedAt ?? task.updatedAt;
}

export function artifactItems(
  tasks: readonly ResearchTask[],
  project: string,
  agentName: (task: ResearchTask) => string | undefined,
): ArtifactItem[] {
  const items: ArtifactItem[] = [];
  for (const task of tasks) {
    if (!task.result || !task.isolation) continue;
    for (const artifact of task.result.artifacts) {
      items.push({
        id: artifactId(task.id, artifact.path),
        taskId: task.id,
        path: artifact.path,
        title: artifact.label.trim() || fileName(artifact.path),
        kind: artifactKind(artifact),
        projectId: task.projectId,
        project,
        updatedAt: finishedAt(task),
        agent: agentName(task),
        chat: task.title.trim() || task.prompt.trim(),
        summary: task.result.summary.trim(),
      });
    }
  }
  return items.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function artifactsForNote(artifacts: readonly ArtifactItem[], note: NoteItem | null | undefined): ArtifactItem[] {
  const projectId = note?.relatedProjectId;
  if (!projectId) return [];
  return artifacts.filter((artifact) => artifact.projectId === projectId);
}

export function noteForProject(notes: readonly NoteItem[], projectId: string): NoteItem | undefined {
  let best: NoteItem | undefined;
  for (const note of notes) {
    if (note.relatedProjectId !== projectId) continue;
    if (!best || note.updatedAt > best.updatedAt) best = note;
  }
  return best;
}

export function experimentItems(
  tasksByProject: ReadonlyMap<string, readonly ResearchTask[]>,
  artifacts: readonly ArtifactItem[],
  notes: readonly NoteItem[],
): ExperimentItem[] {
  const items: ExperimentItem[] = [];
  for (const [projectId, tasks] of tasksByProject) {
    const note = noteForProject(notes, projectId);
    const finished = tasks.filter((task) => task.result);
    if (!note || finished.length === 0) continue;
    const own = artifacts.filter((artifact) => artifact.projectId === projectId);
    items.push({
      projectId,
      project: note.project,
      tasks: finished.length,
      figures: own.filter((artifact) => artifact.kind === "figure").length,
      reports: own.filter((artifact) => artifact.kind === "report" || artifact.kind === "data").length,
      updatedAt: Math.max(...finished.map(finishedAt)),
      noteId: note.id,
    });
  }
  return items.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function csvRows(text: string, separator: string): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let truncated = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.length > TABLE_COLUMNS) truncated = true;
    if (row.some((value) => value !== "")) rows.push(row.slice(0, TABLE_COLUMNS));
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === separator) {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      endRow();
      if (rows.length > TABLE_ROWS) break;
    } else if (character !== "\r") cell += character;
  }
  if (rows.length <= TABLE_ROWS && (cell !== "" || row.length > 0)) endRow();
  if (rows.length > TABLE_ROWS) {
    rows.length = TABLE_ROWS;
    truncated = true;
  }
  return { rows, truncated };
}

export function artifactPreview(artifact: Pick<ArtifactItem, "kind" | "path">, content: TaskPreviewContent): ArtifactPreview {
  if (!content.exists) return { type: "none", reason: "missing" };
  if (artifact.kind === "html") return { type: "none", reason: "html" };
  if (content.base64 && content.mediaType?.startsWith("image/")) {
    return { type: "image", src: `data:${content.mediaType};base64,${content.base64}` };
  }
  if (content.text !== null && content.mediaType === "image/svg+xml") {
    return { type: "image", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content.text)}` };
  }
  if (content.text === null) return { type: "none", reason: "binary" };
  const separator = /\.tsv$/iu.test(artifact.path) ? "\t" : /\.csv$/iu.test(artifact.path) ? "," : null;
  if (separator) {
    const table = csvRows(content.text, separator);
    if (table.rows.length > 0) return { type: "table", rows: table.rows, truncated: table.truncated || content.truncated };
  }
  return {
    type: "text",
    text: content.text.slice(0, TEXT_CHARS),
    truncated: content.truncated || content.text.length > TEXT_CHARS,
  };
}

function markdownLabel(text: string): string {
  return text.replace(/[\\[\]]/gu, (match) => `\\${match}`);
}

function markdownDestination(path: string): string {
  const safe = path.replaceAll("<", "%3C").replaceAll(">", "%3E");
  return /[\s()]/u.test(safe) ? `<${safe}>` : safe;
}

export function artifactSnippet(artifact: Pick<ArtifactItem, "kind" | "title">, path: string): string {
  const link = `[${markdownLabel(artifact.title)}](${markdownDestination(path)})`;
  return artifact.kind === "figure" && !/\.pdf$/iu.test(path) ? `!${link}` : link;
}

export function latestRunContext(tasks: readonly ResearchTask[]): string | null {
  const finished = tasks.filter((task) => task.result && task.status !== "failed" && task.status !== "cancelled");
  if (finished.length === 0) return null;
  const task = finished.reduce((latest, candidate) => (finishedAt(candidate) > finishedAt(latest) ? candidate : latest));
  const result = task.result;
  if (!result) return null;
  const lines = [
    `Task: ${task.title.trim() || task.prompt.trim()}`,
    `Finished: ${new Date(finishedAt(task)).toISOString()}`,
    `Agent: ${task.agentId}${task.modelId ? ` (${task.modelId})` : ""}`,
  ];
  if (task.brief.primaryMetric) {
    lines.push(`Primary metric: ${task.brief.primaryMetric.name} (${task.brief.primaryMetric.goal})`);
  }
  if (result.summary.trim()) lines.push("", "Summary:", result.summary.trim().slice(0, RUN_SUMMARY_CHARS));
  if (result.artifacts.length > 0) {
    lines.push("", "Files it made:", ...result.artifacts.map((artifact) => `- ${artifact.path}: ${artifact.label}`));
  }
  return lines.join("\n");
}

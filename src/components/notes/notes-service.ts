import type { ProjectInfo } from "@oleafly/backend-port";
import { listen } from "@tauri-apps/api/event";
import { loadAssetThumbnail } from "@/components/editor/cm/hover-asset";
import { diskHash } from "@/lib/disk-hash";
import { logError } from "@/lib/log";
import { copyResearchTaskArtifactToNote, previewResearchTaskArtifact } from "@/lib/research-tasks";
import {
  createNoteProject,
  readFileContent,
  recycleProject,
  renameProjectCmd,
  setNoteRelatedProject,
  unwatchProjectFolder,
  watchProjectFolder,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { runNoteAgent } from "./note-agent";
import { artifactPreview } from "./note-artifacts";
import { NOTE_KIND, newNoteSource, readNoteFacts } from "./note-file";
import type { NotesData } from "./notes-data";
import { NoteConflictError, type NoteItem, type NoteSource } from "./types";

const FOLDER_CHANGED_EVENT = "project-folder-changed";

interface FolderChange {
  projectId: string;
  paths: string[];
  rescan: boolean;
}

export type NotesService = Pick<
  NotesData,
  | "proposeEdits"
  | "loadNote"
  | "saveNote"
  | "renameNote"
  | "deleteNote"
  | "createNote"
  | "watchNote"
  | "setRelatedProject"
  | "previewArtifact"
  | "copyArtifact"
  | "resolveAsset"
>;

export interface NotesServiceDeps {
  projects: () => readonly ProjectInfo[];
  refreshProjects: () => Promise<void>;
  refreshHeads: () => void;
  untitled: string;
  missing: string;
}

export function noteItems(
  projects: readonly ProjectInfo[],
  heads: ReadonlyMap<string, string>,
  ungrouped: string,
): NoteItem[] {
  const names = new Map(projects.map((project) => [project.id, project.name]));
  return projects
    .filter((project) => project.kind === NOTE_KIND)
    .map((project) => {
      const facts = readNoteFacts(heads.get(project.id) ?? "");
      const related = project.related_project ? names.get(project.related_project) : undefined;
      return {
        id: project.id,
        title: project.name,
        project: related ?? ungrouped,
        relatedProjectId: related === undefined ? undefined : (project.related_project ?? undefined),
        updatedAt: project.updated_at * 1000,
        author: facts.agent ? "agent" : "you",
        agent: facts.agent,
        icon: facts.icon,
        color: facts.color,
        summary: facts.summary,
      };
    });
}

function lineEndings(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

export function noteVersion(text: string): string {
  return diskHash(lineEndings(text));
}

async function readNote(project: ProjectInfo): Promise<NoteSource> {
  const text = await readFileContent(project.id, project.main_doc);
  return { text, version: noteVersion(text) };
}

function namesFile(path: string, mainDoc: string): boolean {
  return path === mainDoc || path.endsWith(`/${mainDoc}`) || path.endsWith(`\\${mainDoc}`);
}

function watchFile(projectId: string, mainDoc: string, onChange: () => void): () => void {
  let stopped = false;
  const token = watchProjectFolder(projectId).catch((error) => {
    void logError("watch note folder", error);
    return null;
  });
  const unlisten = listen<FolderChange>(FOLDER_CHANGED_EVENT, (event) => {
    const change = event.payload;
    if (stopped || change.projectId !== projectId) return;
    if (change.rescan || change.paths.some((path) => namesFile(path, mainDoc))) onChange();
  });
  return () => {
    stopped = true;
    void unlisten.then((stop) => stop());
    void token.then((id) => {
      if (id !== null) {
        void unwatchProjectFolder(projectId, id).catch((error) => logError("stop watching note folder", error));
      }
    });
  };
}

export function createNotesService(deps: NotesServiceDeps): NotesService {
  const projectOf = (id: string) => {
    const project = deps.projects().find((candidate) => candidate.id === id);
    if (!project) throw new Error(deps.missing);
    return project;
  };
  return {
    proposeEdits: (request, signal) => runNoteAgent(request.agent, request, signal),
    loadNote: async (id) => readNote(projectOf(id)),
    saveNote: async (id, text, version) => {
      const project = projectOf(id);
      const disk = await readNote(project);
      if (disk.version !== version) throw new NoteConflictError(disk);
      const written = lineEndings(text);
      await useFilesStore.getState().writeProjectFile(id, project.main_doc, written);
      deps.refreshHeads();
      return { text: written, version: noteVersion(written) };
    },
    renameNote: async (id, title) => {
      await renameProjectCmd(id, title);
      await deps.refreshProjects();
    },
    deleteNote: async (id) => {
      await recycleProject(id);
      await deps.refreshProjects();
      deps.refreshHeads();
    },
    createNote: async () => {
      const id = await createNoteProject(deps.untitled, newNoteSource(deps.untitled));
      await deps.refreshProjects();
      deps.refreshHeads();
      return id;
    },
    watchNote: (id, onChange) => watchFile(id, projectOf(id).main_doc, onChange),
    setRelatedProject: async (id, projectId) => {
      await setNoteRelatedProject(id, projectId);
      await deps.refreshProjects();
    },
    previewArtifact: async (artifact) =>
      artifactPreview(artifact, (await previewResearchTaskArtifact(artifact.taskId, artifact.path)).content),
    copyArtifact: async (noteId, artifact) =>
      (await copyResearchTaskArtifactToNote(artifact.taskId, artifact.path, noteId)).path,
    resolveAsset: (noteId, path) => loadAssetThumbnail(noteId, path),
  };
}

export function relatedProjectChoices(projects: readonly ProjectInfo[]): { id: string; name: string }[] {
  return projects
    .filter((project) => project.kind !== NOTE_KIND && !project.recovery_pending)
    .sort((left, right) => right.updated_at - left.updated_at)
    .map((project) => ({ id: project.id, name: project.name }));
}

import {
  importOverleafProjectCmd,
  listProjects,
  recycleProject,
  setMainDocCmd,
  setProjectEngineCmd,
} from "@/lib/tauri";
import {
  RESEARCH_SEED_PROJECTS,
  type ResearchSeedProject,
} from "@/developer/research-seed-catalog";

export interface ResearchSeedProgress {
  current: number;
  total: number;
  name: string;
}

export interface ResearchSeedResult {
  created: number;
  skipped: number;
  failed: Array<{ name: string; message: string }>;
}

export function researchSeedArchiveName(project: ResearchSeedProject): string {
  return `${project.slug}.zip`;
}

export function researchSeedRoot(libraryPath: string): string {
  const normalized = libraryPath.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  const suffix = "/.oleafly-dev/projects";
  if (!normalized.toLowerCase().endsWith(suffix)) {
    throw new Error("Research fixtures can only be copied into the .oleafly-dev sandbox");
  }
  const home = normalized.slice(0, -suffix.length);
  return `${home}/Codespace/Oleafly/oleafly-seed`;
}

function archivePath(seedRoot: string, project: ResearchSeedProject): string {
  return `${seedRoot.replace(/\/+$/, "")}/archives/${researchSeedArchiveName(project)}`;
}

async function copySeedProject(seedRoot: string, project: ResearchSeedProject): Promise<void> {
  const projectId = await importOverleafProjectCmd(
    archivePath(seedRoot, project),
    project.name,
  );
  try {
    await setMainDocCmd(projectId, project.mainDoc);
    await setProjectEngineCmd(projectId, project.engine, null);
  } catch (error) {
    await recycleProject(projectId).catch(() => undefined);
    throw error;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return typeof error === "string" && error.trim() ? error : "Unknown seed error";
}

export async function seedResearchProjects(
  seedRoot: string,
  onProgress?: (progress: ResearchSeedProgress) => void,
): Promise<ResearchSeedResult> {
  const existingNames = new Set((await listProjects()).map((project) => project.name));
  const result: ResearchSeedResult = { created: 0, skipped: 0, failed: [] };
  for (const [index, project] of RESEARCH_SEED_PROJECTS.entries()) {
    onProgress?.({ current: index + 1, total: RESEARCH_SEED_PROJECTS.length, name: project.name });
    if (existingNames.has(project.name)) {
      result.skipped += 1;
      continue;
    }
    try {
      await copySeedProject(seedRoot, project);
      result.created += 1;
      existingNames.add(project.name);
    } catch (error) {
      result.failed.push({ name: project.name, message: errorMessage(error) });
    }
  }
  return result;
}

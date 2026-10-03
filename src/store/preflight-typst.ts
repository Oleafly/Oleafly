import type { Finding, ProjectContext, SourceRuleSet } from "@oleafly/preflight";
import {
  DEFAULT_TYPST_VERSION,
  TYPST_SOURCE_RULES,
  runTypstSourceRules,
  typstReferencedImages,
} from "@oleafly/preflight/typst";
import { type DocumentEngineDescriptor, projectFileSizes } from "@/lib/tauri";

export const MAX_MEASURED_IMAGES = 256;

export interface TypstPreflightInputs {
  readonly sourceRules: SourceRuleSet;
  readonly typstVersion: string;
  readonly project: ProjectContext;
}

export function typstVersionFor(engine: DocumentEngineDescriptor): string {
  return engine.typst_resolved?.version ?? DEFAULT_TYPST_VERSION;
}

export async function measureImageSizes(projectId: string, paths: readonly string[]): Promise<Map<string, number>> {
  const requested = [...new Set(paths)].slice(0, MAX_MEASURED_IMAGES);
  const ordered = new Map<string, number>();
  if (requested.length === 0) return ordered;
  let measured: Record<string, number>;
  try {
    measured = await projectFileSizes(projectId, requested);
  } catch {
    return ordered;
  }
  for (const path of requested) {
    const size = measured[path];
    if (typeof size === "number") ordered.set(path, size);
  }
  return ordered;
}

export async function typstPreflightInputs(
  projectId: string | null,
  project: ProjectContext,
  engine: DocumentEngineDescriptor,
): Promise<TypstPreflightInputs> {
  const sizes = projectId ? await measureImageSizes(projectId, typstReferencedImages(project)) : new Map<string, number>();
  return {
    sourceRules: TYPST_SOURCE_RULES,
    typstVersion: typstVersionFor(engine),
    project: {
      ...project,
      files: project.files.map((file) => {
        const size = sizes.get(file.path);
        return size === undefined ? file : { ...file, size };
      }),
    },
  };
}

export function typstEditorFindings(text: string, engine: DocumentEngineDescriptor): Finding[] {
  return runTypstSourceRules(text, { version: typstVersionFor(engine) });
}

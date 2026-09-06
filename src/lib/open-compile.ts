export function shouldCompileOnOpen(
  projectId: string | null,
  hasFiles: boolean,
  engineLoaded: boolean,
  alreadyCompiledProjectId: string | null,
  _viewMode: string,
  compileStatus: string,
  projectHydrated = true,
  hasValidCurrentArtifact = false,
) {
  return (
    !!projectId &&
    hasFiles &&
    engineLoaded &&
    projectHydrated &&
    !hasValidCurrentArtifact &&
    compileStatus !== "compiling" &&
    alreadyCompiledProjectId !== projectId
  );
}

export function resetOpenCompileMarker(
  projectId: string | null,
  marker: string | null,
) {
  return projectId === null ? null : marker;
}

export function openCompileHydrated(
  projectLoading: boolean,
  projectId: string | null,
  analysisProjectId: string | null,
  analysisProjectRevision: number,
) {
  return (
    !projectLoading &&
    !!projectId &&
    analysisProjectId === projectId &&
    analysisProjectRevision > 0
  );
}

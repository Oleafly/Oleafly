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

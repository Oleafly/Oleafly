export function shouldCompileOnOpen(
  projectId: string | null,
  hasFiles: boolean,
  engineLoaded: boolean,
  alreadyCompiledProjectId: string | null,
  viewMode: string,
  compileStatus: string,
) {
  return (
    !!projectId &&
    hasFiles &&
    engineLoaded &&
    compileStatus !== "compiling" &&
    alreadyCompiledProjectId !== projectId &&
    (viewMode === "split" || viewMode === "pdf")
  );
}

export function resetOpenCompileMarker(
  projectId: string | null,
  marker: string | null,
) {
  return projectId === null ? null : marker;
}

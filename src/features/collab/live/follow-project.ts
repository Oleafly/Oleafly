interface ProjectSource {
  getState(): { projectId: string | null };
  subscribe(listener: (state: { projectId: string | null }) => void): () => void;
}

export function followProject(source: ProjectSource, open: (projectId: string | null) => void): () => void {
  let projectId = source.getState().projectId;
  open(projectId);
  return source.subscribe((state) => {
    if (state.projectId === projectId) return;
    projectId = state.projectId;
    open(projectId);
  });
}

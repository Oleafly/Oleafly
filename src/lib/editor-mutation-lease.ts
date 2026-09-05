export interface EditorMutationOwner {
  projectId: () => string | null;
  setLocked?: (locked: boolean) => void;
  flush?: () => void | Promise<void>;
  reconcile?: () => void | Promise<void>;
}

const owners = new Set<EditorMutationOwner>();
let active: { projectId: string; locked: Set<EditorMutationOwner> } | null = null;

export function isEditorMutationLocked(projectId: string | null): boolean {
  return projectId !== null && active?.projectId === projectId;
}

export function registerEditorMutationOwner(owner: EditorMutationOwner): () => void {
  owners.add(owner);
  if (active?.projectId === owner.projectId()) {
    active.locked.add(owner);
    try { owner.setLocked?.(true); } catch (error) {
      active.locked.delete(owner);
      owners.delete(owner);
      throw error;
    }
  }
  return () => {
    owners.delete(owner);
    if (active?.locked.delete(owner)) {
      try { owner.setLocked?.(false); } catch {}
    }
  };
}

export function acquireEditorMutationLease(projectId: string) {
  if (active) throw new Error("Another project update is still in progress.");
  const lease = { projectId, locked: new Set<EditorMutationOwner>() };
  active = lease;
  const release = () => {
    if (active !== lease) return;
    active = null;
    for (const owner of lease.locked) {
      try { owner.setLocked?.(false); } catch {}
    }
    lease.locked.clear();
  };
  try {
    for (const owner of owners) {
      if (owner.projectId() !== projectId) continue;
      lease.locked.add(owner);
      owner.setLocked?.(true);
    }
  } catch (error) {
    release();
    throw error;
  }
  return {
    release,
    assertActive() {
      if (active !== lease) throw new Error("The project update was interrupted before it started.");
    },
    async flush() {
      for (const owner of [...owners]) {
        if (owner.projectId() === projectId) await owner.flush?.();
      }
    },
    async reconcile() {
      for (const owner of [...owners]) {
        if (owner.projectId() === projectId) await owner.reconcile?.();
      }
    },
  };
}

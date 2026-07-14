import { gitAutoCommitUpdate } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

const IDLE_COMMIT_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingProjectId: string | null = null;

// Don't commit while the user is staging in the Source Control panel.
const sourceControlOpen = () => useSettingsStore.getState().railTab === "source";

async function commit(projectId: string) {
  if (sourceControlOpen()) return;
  try {
    await gitAutoCommitUpdate(projectId);
  } catch {
    // A failed auto-commit must never interrupt editing.
  }
}

export function scheduleAutoCommit(projectId: string) {
  pendingProjectId = projectId;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    pendingProjectId = null;
    void commit(projectId);
  }, IDLE_COMMIT_MS);
}

export function cancelAutoCommit(projectId: string) {
  if (pendingProjectId !== projectId) return;
  if (timer) clearTimeout(timer);
  timer = null;
  pendingProjectId = null;
}

export function flushAutoCommit() {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  const id = pendingProjectId;
  pendingProjectId = null;
  if (id) void commit(id);
}

export async function autoCommitNow(projectId: string) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pendingProjectId = null;
  await commit(projectId);
}

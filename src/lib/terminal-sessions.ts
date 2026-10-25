// Which shell session each terminal tab runs, so a close, a project switch or
// a quit can ask Rust which tabs are busy.
import { termForeground } from "./terminal-ipc";

interface TerminalSessionRecord {
  projectId: string;
  sessionId: string;
}

const sessions = new Map<string, TerminalSessionRecord>();

/** Records the tab's session; the returned function forgets it again. */
export function registerTerminalSession(tabId: string, projectId: string, sessionId: string): () => void {
  const record: TerminalSessionRecord = { projectId, sessionId };
  sessions.set(tabId, record);
  return () => {
    if (sessions.get(tabId) === record) sessions.delete(tabId);
  };
}

export function terminalSessionFor(tabId: string): { projectId: string; sessionId: string } | undefined {
  return sessions.get(tabId);
}

export interface TerminalTabJob {
  tabId: string;
  /** The running program's name, when the system tells. */
  process: string | null;
}

/**
 * The project's tabs (all, or `tabIds`) that run a program besides their
 * shell. A failed check counts as nothing running, so it never blocks a close.
 */
export async function terminalJobs(projectId: string, tabIds?: readonly string[]): Promise<TerminalTabJob[]> {
  const entries = [...sessions].filter(
    ([tabId, record]) => record.projectId === projectId && (!tabIds || tabIds.includes(tabId)),
  );
  if (entries.length === 0) return [];
  const tabBySession = new Map(entries.map(([tabId, record]) => [record.sessionId, tabId]));
  try {
    const jobs = await termForeground(
      projectId,
      entries.map(([, record]) => record.sessionId),
    );
    return jobs.flatMap((job) => {
      const tabId = tabBySession.get(job.id);
      return tabId ? [{ tabId, process: job.process }] : [];
    });
  } catch {
    return [];
  }
}

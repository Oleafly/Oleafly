export function cancelChatRun(
  controller: AbortController | null,
  persistTimer: ReturnType<typeof setTimeout> | number | null,
  discardQueuedPatches?: () => void,
): void {
  controller?.abort();
  if (persistTimer) clearTimeout(persistTimer);
  discardQueuedPatches?.();
}

export interface ChatRunIdentity {
  generation: number;
  projectId: string | null;
}

export class ChatRunIsolation {
  private generation = 0;

  begin(projectId: string | null): ChatRunIdentity {
    return { generation: ++this.generation, projectId };
  }

  invalidate(): void {
    this.generation += 1;
  }

  allows(identity: ChatRunIdentity, currentProjectId: string | null): boolean {
    return identity.generation === this.generation && identity.projectId === currentProjectId;
  }
}

export function scheduleChatPersistence<T>(
  previous: ReturnType<typeof setTimeout> | null,
  chatId: string | null,
  value: T,
  save: (chatId: string, value: T) => void,
  delay = 400,
): ReturnType<typeof setTimeout> {
  if (previous) clearTimeout(previous);
  return setTimeout(() => {
    if (chatId) save(chatId, value);
  }, delay);
}

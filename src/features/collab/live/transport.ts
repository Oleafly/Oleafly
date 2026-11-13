import { collabDocChange, collabDocClose, collabDocOpen } from "@/lib/tauri-collab";
import type { RemoteSessionTransport } from "./remote-session";

export function collabSessionTransport(projectId: string): RemoteSessionTransport {
  return {
    open: (path, onMessage) => collabDocOpen(projectId, path, onMessage),
    change: (fileId, rev, op) => collabDocChange(projectId, fileId, rev, op),
    close: (fileId, session) => collabDocClose(projectId, fileId, session),
  };
}

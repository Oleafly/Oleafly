import { emitTo } from "@tauri-apps/api/event";
import type { CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import type { SynctexForwardHit } from "@/lib/tauri";

export const PREVIEW_FORWARD_EVENT = "preview:forward";

export interface PreviewForwardJump {
  projectId: string;
  checkpoint: CompileSuccessCheckpoint;
  hit: SynctexForwardHit;
  spot: { word: string; before: string; after: string } | null;
  typst: boolean;
}

export function sendPreviewForward(jump: PreviewForwardJump): Promise<void> {
  return emitTo("preview", PREVIEW_FORWARD_EVENT, jump);
}

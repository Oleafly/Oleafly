import type { ScriptedBlockProps, ScriptedKind, ScriptedMount } from "./ArtifactFrame";
import { blockMessage, type Dispose, type PaintContext } from "./note-blocks";

interface Slot {
  mount: ScriptedMount | null;
  loading: boolean;
  generation: number;
  running: boolean;
  code: string | null;
  closed: boolean;
  render: () => void;
}

const slots = new WeakMap<HTMLElement, Slot>();

export interface ScriptedPaint {
  kind: ScriptedKind;
  label: string;
  scripted: boolean;
  loadingText: string;
  failedText: string;
}

export function paintScripted(preview: HTMLElement, source: string, context: PaintContext, paint: ScriptedPaint): Dispose {
  let slot = slots.get(preview);
  if (!slot || slot.closed) {
    slot = { mount: null, loading: false, generation: 0, running: false, code: null, closed: false, render: () => undefined };
    slots.set(preview, slot);
  }
  const current = slot;
  const code = `${paint.kind}\n${source}`;
  if (current.code !== code) {
    current.code = code;
    current.running = false;
  }
  current.generation += 1;
  const generation = current.generation;
  const props = (): ScriptedBlockProps => ({
    kind: paint.kind,
    source,
    label: paint.label,
    noteId: context.noteId ?? null,
    scripted: paint.scripted,
    running: current.running,
    onRunningChange: (running) => {
      current.running = running;
      current.render();
    },
  });
  current.render = () => current.mount?.render(props());
  if (current.mount) current.render();
  else if (!current.loading) {
    current.loading = true;
    blockMessage(preview, paint.loadingText);
    import("./ArtifactFrame")
      .then(({ mountScriptedBlock }) => {
        current.loading = false;
        if (current.closed) return;
        const host = document.createElement("div");
        host.className = "note-scripted";
        current.mount = mountScriptedBlock(host);
        preview.replaceChildren(host);
        current.render();
      })
      .catch(() => {
        current.loading = false;
        if (!current.closed) blockMessage(preview, paint.failedText);
      });
  }
  return () => {
    queueMicrotask(() => {
      if (current.generation !== generation || current.closed) return;
      current.closed = true;
      current.mount?.unmount();
      current.mount = null;
      slots.delete(preview);
    });
  };
}

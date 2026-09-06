import { type DiagramModel, modelToTikz, sameDiagramModel } from "@oleafly/latex";

export interface ComposerSync {
  /** The code buffer holds text the canvas did not generate. */
  codeDirty: boolean;
  /** The canvas has changed since the buffer was last written from it. */
  canvasAhead: boolean;
  /** The exact buffer the current model was read out of, if any. */
  adoptedSource: string | null;
  /** The model as it was read out of that buffer, before any canvas edit. */
  adoptedModel: DiagramModel | null;
}

export function emptySync(): ComposerSync {
  return { codeDirty: false, canvasAhead: false, adoptedSource: null, adoptedModel: null };
}

export function readSync(source: string, model: DiagramModel | null): ComposerSync {
  return { codeDirty: true, canvasAhead: false, adoptedSource: source, adoptedModel: model };
}

export function typedSync(sync: ComposerSync): ComposerSync {
  return { ...sync, codeDirty: true, canvasAhead: false };
}

export function drawnSync(sync: ComposerSync): ComposerSync {
  return { ...sync, canvasAhead: true };
}

export function shouldReadCode(sync: ComposerSync, code: string): boolean {
  return sync.codeDirty && !sync.canvasAhead && sync.adoptedSource !== code;
}

export function shouldWriteCode(sync: ComposerSync, hasDrawing: boolean): boolean {
  return hasDrawing && (!sync.codeDirty || sync.canvasAhead);
}

export function shouldPublishModel(sync: ComposerSync, next: DiagramModel): boolean {
  return !(sync.adoptedModel !== null && sameDiagramModel(sync.adoptedModel, next));
}

export function sourceToCompile(
  sync: ComposerSync,
  mode: "draw" | "code",
  model: DiagramModel,
  code: string,
): string {
  if (model.nodes.length === 0) return code;
  if (sync.canvasAhead) return modelToTikz(model);
  return mode === "draw" && !sync.codeDirty ? modelToTikz(model) : code;
}

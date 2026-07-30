import { FileContents, HunkSeparators, MergeConflictResolution, PostRenderPhase } from "../types.js";
import { FileDiffOptions } from "../components/FileDiff.js";
import { MergeConflictDiffAction } from "../utils/parseMergeConflictDiffFromFile.js";
import { UnresolvedFileHunksRendererOptions } from "../renderers/UnresolvedFileHunksRenderer.js";
import { UnresolvedFile as UnresolvedFile$1 } from "../components/UnresolvedFile.js";
import { FileDiffProps } from "./FileDiff.js";
import { ReactNode } from "react";

//#region src/react/UnresolvedFile.d.ts
interface RenderMergeConflictActionContext {
  resolveConflict(resolution: MergeConflictResolution): void;
}
type RenderMergeConflictActions = (action: MergeConflictDiffAction, context: RenderMergeConflictActionContext) => ReactNode;
type MergeConflictActionsTypeOption = 'none' | 'default' | RenderMergeConflictActions;
interface UnresolvedFileReactOptions<LAnnotation> extends Omit<FileDiffOptions<LAnnotation>, 'hunkSeparators' | 'diffStyle' | 'onMergeConflictAction' | 'onPostRender'>, UnresolvedFileHunksRendererOptions {
  hunkSeparators?: HunkSeparators;
  onPostRender?(node: HTMLElement, instance: UnresolvedFile$1<LAnnotation>, phase: PostRenderPhase): unknown;
  maxContextLines?: number;
}
interface UnresolvedFileProps<LAnnotation> extends Omit<FileDiffProps<LAnnotation>, 'fileDiff' | 'options'> {
  file: FileContents;
  options?: UnresolvedFileReactOptions<LAnnotation>;
  renderMergeConflictUtility?(action: MergeConflictDiffAction, getInstance: () => UnresolvedFile$1<LAnnotation> | undefined): ReactNode;
  disableWorkerPool?: boolean;
}
declare function UnresolvedFile<LAnnotation = undefined>({
  file,
  options,
  lineAnnotations,
  selectedLines,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderMetadata,
  renderGutterUtility,
  renderMergeConflictUtility,
  disableWorkerPool
}: UnresolvedFileProps<LAnnotation>): React.JSX.Element;
//#endregion
export { MergeConflictActionsTypeOption, RenderMergeConflictActionContext, RenderMergeConflictActions, UnresolvedFile, UnresolvedFileProps, UnresolvedFileReactOptions };
//# sourceMappingURL=UnresolvedFile.d.ts.map
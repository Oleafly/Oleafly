import { DiffLineAnnotation, FileContents, FileDiffMetadata, MergeConflictMarkerRow, SelectedLineRange } from "../../types.js";
import { GetHoveredLineResult } from "../../managers/InteractionManager.js";
import { MergeConflictDiffAction } from "../../utils/parseMergeConflictDiffFromFile.js";
import { UnresolvedFile } from "../../components/UnresolvedFile.js";
import { UnresolvedFileReactOptions } from "../UnresolvedFile.js";

//#region src/react/utils/useUnresolvedFileInstance.d.ts
interface UseUnresolvedFileInstanceProps<LAnnotation> {
  file: FileContents;
  options?: UnresolvedFileReactOptions<LAnnotation>;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  hasConflictUtility: boolean;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
}
interface UseUnresolvedFileInstanceReturn<LAnnotation> {
  fileDiff: FileDiffMetadata;
  actions: (MergeConflictDiffAction | undefined)[];
  markerRows: MergeConflictMarkerRow[];
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
  getInstance(): UnresolvedFile<LAnnotation> | undefined;
}
declare function useUnresolvedFileInstance<LAnnotation>({
  file,
  options,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
  hasConflictUtility,
  hasGutterRenderUtility,
  hasCustomHeader,
  disableWorkerPool
}: UseUnresolvedFileInstanceProps<LAnnotation>): UseUnresolvedFileInstanceReturn<LAnnotation>;
//#endregion
export { useUnresolvedFileInstance };
//# sourceMappingURL=useUnresolvedFileInstance.d.ts.map
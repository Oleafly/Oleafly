import { FileContents, LineAnnotation, SelectedLineRange, VirtualFileMetrics } from "../../types.js";
import { GetHoveredLineResult } from "../../managers/InteractionManager.js";
import { FileOptions } from "../../components/File.js";

//#region src/react/utils/useFileInstance.d.ts
interface UseFileInstanceProps<LAnnotation> {
  file: FileContents;
  options: FileOptions<LAnnotation> | undefined;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
}
interface UseFileInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
}
declare function useFileInstance<LAnnotation>({
  file,
  options,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
  metrics,
  hasGutterRenderUtility,
  hasCustomHeader,
  disableWorkerPool
}: UseFileInstanceProps<LAnnotation>): UseFileInstanceReturn;
//#endregion
export { useFileInstance };
//# sourceMappingURL=useFileInstance.d.ts.map
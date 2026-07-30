import { DiffLineAnnotation, FileContents, FileDiffMetadata, LineAnnotation, SelectedLineRange, VirtualFileMetrics } from "../types.js";
import { GetHoveredLineResult } from "../managers/InteractionManager.js";
import { FileOptions } from "../components/File.js";
import { FileDiffOptions } from "../components/FileDiff.js";
import { CSSProperties, ReactNode } from "react";

//#region src/react/types.d.ts
interface DiffBasePropsReact<LAnnotation> {
  options?: FileDiffOptions<LAnnotation>;
  metrics?: VirtualFileMetrics;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  selectedLines?: SelectedLineRange | null;
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderCustomHeader?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderPrefix?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderMetadata?(fileDiff: FileDiffMetadata): ReactNode;
  renderGutterUtility?(getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}
interface FileProps<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  metrics?: VirtualFileMetrics;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  selectedLines?: SelectedLineRange | null;
  renderAnnotation?(annotations: LineAnnotation<LAnnotation>): ReactNode;
  renderCustomHeader?(file: FileContents): ReactNode;
  renderHeaderPrefix?(file: FileContents): ReactNode;
  renderHeaderMetadata?(file: FileContents): ReactNode;
  renderGutterUtility?(getHoveredLine: () => GetHoveredLineResult<'file'> | undefined): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
  disableWorkerPool?: boolean;
}
//#endregion
export { DiffBasePropsReact, FileProps };
//# sourceMappingURL=types.d.ts.map
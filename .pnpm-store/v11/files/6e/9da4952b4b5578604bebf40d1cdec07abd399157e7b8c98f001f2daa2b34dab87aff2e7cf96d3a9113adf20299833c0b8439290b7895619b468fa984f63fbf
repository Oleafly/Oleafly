import { DiffLineAnnotation, FileContents, FileDiffMetadata } from "../types.js";
import { FileDiffOptions } from "../components/FileDiff.js";
import { UnresolvedFileOptions } from "../components/UnresolvedFile.js";

//#region src/ssr/preloadDiffs.d.ts
interface PreloadDiffOptions<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}
declare function preloadDiffHTML<LAnnotation = undefined>({
  fileDiff,
  oldFile,
  newFile,
  options,
  annotations
}: PreloadDiffOptions<LAnnotation>): Promise<string>;
declare function preloadUnresolvedFileHTML<LAnnotation = undefined>({
  file,
  options,
  annotations
}: PreloadUnresolvedFileOptions<LAnnotation>): Promise<string>;
interface PreloadMultiFileDiffOptions<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}
interface PreloadMultiFileDiffResult<LAnnotation> extends PreloadMultiFileDiffOptions<LAnnotation> {
  prerenderedHTML: string;
}
declare function preloadMultiFileDiff<LAnnotation = undefined>({
  oldFile,
  newFile,
  options,
  annotations
}: PreloadMultiFileDiffOptions<LAnnotation>): Promise<PreloadMultiFileDiffResult<LAnnotation>>;
interface PreloadFileDiffOptions<LAnnotation> {
  fileDiff: FileDiffMetadata;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}
interface PreloadFileDiffResult<LAnnotation> extends PreloadFileDiffOptions<LAnnotation> {
  prerenderedHTML: string;
}
declare function preloadFileDiff<LAnnotation = undefined>({
  fileDiff,
  options,
  annotations
}: PreloadFileDiffOptions<LAnnotation>): Promise<PreloadFileDiffResult<LAnnotation>>;
interface PreloadUnresolvedFileOptions<LAnnotation> {
  file: FileContents;
  options?: Omit<UnresolvedFileOptions<LAnnotation>, 'onMergeConflictAction' | 'onMergeConflictResolve' | 'onPostRender'>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}
interface PreloadUnresolvedFileResult<LAnnotation> extends PreloadUnresolvedFileOptions<LAnnotation> {
  prerenderedHTML: string;
}
declare function preloadUnresolvedFile<LAnnotation = undefined>({
  file,
  options,
  annotations
}: PreloadUnresolvedFileOptions<LAnnotation>): Promise<PreloadUnresolvedFileResult<LAnnotation>>;
interface PreloadPatchDiffOptions<LAnnotation> {
  patch: string;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}
interface PreloadPatchDiffResult<LAnnotation> extends PreloadPatchDiffOptions<LAnnotation> {
  prerenderedHTML: string;
}
declare function preloadPatchDiff<LAnnotation = undefined>({
  patch,
  options,
  annotations
}: PreloadPatchDiffOptions<LAnnotation>): Promise<PreloadPatchDiffResult<LAnnotation>>;
//#endregion
export { PreloadDiffOptions, PreloadFileDiffOptions, PreloadFileDiffResult, PreloadMultiFileDiffOptions, PreloadMultiFileDiffResult, PreloadPatchDiffOptions, PreloadPatchDiffResult, PreloadUnresolvedFileOptions, PreloadUnresolvedFileResult, preloadDiffHTML, preloadFileDiff, preloadMultiFileDiff, preloadPatchDiff, preloadUnresolvedFile, preloadUnresolvedFileHTML };
//# sourceMappingURL=preloadDiffs.d.ts.map
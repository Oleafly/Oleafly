import { FileDiffOptions } from "../components/FileDiff.js";
import { PreloadFileDiffResult } from "./preloadDiffs.js";

//#region src/ssr/preloadPatchFile.d.ts
type PreloadPatchFileOptions<LAnnotation> = {
  patch: string;
  options?: FileDiffOptions<LAnnotation>;
};
declare function preloadPatchFile<LAnnotation = undefined>({
  patch,
  options
}: PreloadPatchFileOptions<LAnnotation>): Promise<PreloadFileDiffResult<LAnnotation>[]>;
//#endregion
export { PreloadPatchFileOptions, preloadPatchFile };
//# sourceMappingURL=preloadPatchFile.d.ts.map
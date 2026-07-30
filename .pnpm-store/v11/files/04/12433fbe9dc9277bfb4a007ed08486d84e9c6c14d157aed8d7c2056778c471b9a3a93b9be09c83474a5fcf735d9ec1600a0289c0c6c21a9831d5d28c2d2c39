import { FileContents, LineAnnotation } from "../types.js";
import { FileOptions } from "../components/File.js";

//#region src/ssr/preloadFile.d.ts
type PreloadFileOptions<LAnnotation> = {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
};
interface PreloadedFileResult<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
  prerenderedHTML: string;
}
declare function preloadFile<LAnnotation = undefined>({
  file,
  options,
  annotations
}: PreloadFileOptions<LAnnotation>): Promise<PreloadedFileResult<LAnnotation>>;
//#endregion
export { PreloadFileOptions, PreloadedFileResult, preloadFile };
//# sourceMappingURL=preloadFile.d.ts.map
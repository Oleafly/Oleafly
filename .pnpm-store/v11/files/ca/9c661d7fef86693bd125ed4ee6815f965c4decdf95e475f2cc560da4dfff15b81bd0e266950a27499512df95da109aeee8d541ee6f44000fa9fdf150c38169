import { FileContents, FileDiffMetadata, ParsedPatch } from "../types.js";

//#region src/utils/parsePatchFiles.d.ts
declare function processPatch(data: string, cacheKeyPrefix?: string, throwOnError?: boolean): ParsedPatch;
interface ProcessFileOptions {
  cacheKey?: string;
  isGitDiff?: boolean;
  oldFile?: FileContents;
  newFile?: FileContents;
  throwOnError?: boolean;
}
declare function processFile(fileDiffString: string, options?: ProcessFileOptions): FileDiffMetadata | undefined;
/**
 * Parses a patch file string into an array of parsed patches.
 *
 * @param data - The raw patch file content (supports multi-commit patches)
 * @param cacheKeyPrefix - Optional prefix for generating cache keys. When provided,
 *   each file in the patch will get a cache key in the format `prefix-patchIndex-fileIndex`.
 *   This enables caching of rendered diff results in the worker pool.
 */
declare function parsePatchFiles(data: string, cacheKeyPrefix?: string, throwOnError?: boolean): ParsedPatch[];
//#endregion
export { parsePatchFiles, processFile, processPatch };
//# sourceMappingURL=parsePatchFiles.d.ts.map
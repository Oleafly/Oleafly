import { FileContents, FileDiffMetadata, MergeConflictMarkerRow, MergeConflictRegion, ProcessFileConflictData } from "../types.js";

//#region src/utils/parseMergeConflictDiffFromFile.d.ts
interface ParseMergeConflictDiffFromFileResult {
  fileDiff: FileDiffMetadata;
  currentFile: FileContents;
  incomingFile: FileContents;
  actions: (MergeConflictDiffAction | undefined)[];
  markerRows: MergeConflictMarkerRow[];
}
interface MergeConflictDiffAction extends ProcessFileConflictData {
  conflict: MergeConflictRegion;
  conflictIndex: number;
  markerLines: {
    start: string;
    base?: string;
    separator: string;
    end: string;
  };
}
interface GetMergeConflictActionAnchorReturn {
  hunkIndex: number;
  lineIndex: number;
}
declare function getMergeConflictActionAnchor(action: MergeConflictDiffAction, fileDiff: FileDiffMetadata): GetMergeConflictActionAnchorReturn | undefined;
declare function parseMergeConflictDiffFromFile(file: FileContents, maxContextLines?: number): ParseMergeConflictDiffFromFileResult;
declare function buildMergeConflictMarkerRows(fileDiff: FileDiffMetadata, actions: (MergeConflictDiffAction | undefined)[]): MergeConflictMarkerRow[];
//#endregion
export { MergeConflictDiffAction, ParseMergeConflictDiffFromFileResult, buildMergeConflictMarkerRows, getMergeConflictActionAnchor, parseMergeConflictDiffFromFile };
//# sourceMappingURL=parseMergeConflictDiffFromFile.d.ts.map
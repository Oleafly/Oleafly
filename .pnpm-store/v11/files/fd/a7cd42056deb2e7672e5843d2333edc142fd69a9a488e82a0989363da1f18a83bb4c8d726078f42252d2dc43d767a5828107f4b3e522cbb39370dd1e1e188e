import { MergeConflictRegion } from "../types.js";

//#region src/utils/getMergeConflictLineTypes.d.ts
type MergeConflictLineType = 'none' | 'marker-start' | 'marker-base' | 'marker-separator' | 'marker-end' | 'current' | 'base' | 'incoming';
interface MergeConflictParseResult {
  lineTypes: MergeConflictLineType[];
  regions: MergeConflictRegion[];
}
declare function getMergeConflictLineTypes(lines: string[]): MergeConflictLineType[];
declare function getMergeConflictParseResult(lines: string[]): MergeConflictParseResult;
declare function getMergeConflictActionLineNumber(conflict: MergeConflictRegion): number;
//#endregion
export { MergeConflictLineType, MergeConflictParseResult, getMergeConflictActionLineNumber, getMergeConflictLineTypes, getMergeConflictParseResult };
//# sourceMappingURL=getMergeConflictLineTypes.d.ts.map
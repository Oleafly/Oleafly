import { FileDiffMetadata, Hunk, HunkExpansionRegion } from "../types.js";

//#region src/utils/iterateOverDiff.d.ts
interface DiffLineMetadata {
  unifiedLineIndex: number;
  splitLineIndex: number;
  lineIndex: number;
  lineNumber: number;
  noEOFCR: boolean;
}
interface DiffLineCallbackBase {
  hunkIndex: number;
  hunk: Hunk | undefined;
  collapsedBefore: number;
  collapsedAfter: number;
}
interface DiffLineCallbackContextChange extends DiffLineCallbackBase {
  type: 'change' | 'context' | 'context-expanded';
  deletionLine: DiffLineMetadata;
  additionLine: DiffLineMetadata;
}
interface DiffLineCallbackChangeDeletion extends DiffLineCallbackBase {
  type: 'change';
  deletionLine: DiffLineMetadata;
  additionLine?: undefined;
}
interface DiffLineCallbackChangeAddition extends DiffLineCallbackBase {
  type: 'change';
  deletionLine?: undefined;
  additionLine: DiffLineMetadata;
}
type DiffLineCallbackProps = DiffLineCallbackContextChange | DiffLineCallbackChangeDeletion | DiffLineCallbackChangeAddition;
type DiffStyle = 'unified' | 'split' | 'both';
type DiffLineCallback = (props: DiffLineCallbackProps) => boolean | void;
interface IterateOverDiffProps {
  diff: FileDiffMetadata;
  diffStyle: DiffStyle;
  startingLine?: number;
  totalLines?: number;
  expandedHunks?: Map<number, HunkExpansionRegion> | true;
  collapsedContextThreshold?: number;
  callback: DiffLineCallback;
}
declare function iterateOverDiff({
  diff,
  diffStyle,
  startingLine,
  totalLines,
  expandedHunks,
  collapsedContextThreshold,
  callback
}: IterateOverDiffProps): void;
//#endregion
export { DiffLineCallback, DiffLineCallbackBase, DiffLineCallbackProps, DiffLineMetadata, IterateOverDiffProps, iterateOverDiff };
//# sourceMappingURL=iterateOverDiff.d.ts.map
import { FileDiffMetadata } from "../../types.js";
import { GetHoveredLineResult } from "../../managers/InteractionManager.js";
import { MergeConflictDiffAction } from "../../utils/parseMergeConflictDiffFromFile.js";
import { DiffBasePropsReact } from "../types.js";
import { ReactNode } from "react";

//#region src/react/utils/renderDiffChildren.d.ts
interface RenderDiffChildrenProps<LAnnotation, T> {
  fileDiff: FileDiffMetadata;
  actions?: (MergeConflictDiffAction | undefined)[];
  renderCustomHeader: DiffBasePropsReact<LAnnotation>['renderCustomHeader'];
  renderHeaderPrefix: DiffBasePropsReact<LAnnotation>['renderHeaderPrefix'];
  renderHeaderMetadata: DiffBasePropsReact<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: DiffBasePropsReact<LAnnotation>['renderAnnotation'];
  renderGutterUtility: DiffBasePropsReact<LAnnotation>['renderGutterUtility'];
  renderMergeConflictUtility?(action: MergeConflictDiffAction, getInstance: () => T | undefined): ReactNode;
  lineAnnotations: DiffBasePropsReact<LAnnotation>['lineAnnotations'];
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
  getInstance?(): T | undefined;
}
declare function renderDiffChildren<LAnnotation, T>({
  fileDiff,
  actions,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderMetadata,
  renderAnnotation,
  renderGutterUtility,
  renderMergeConflictUtility,
  lineAnnotations,
  getHoveredLine,
  getInstance
}: RenderDiffChildrenProps<LAnnotation, T>): ReactNode;
//#endregion
export { renderDiffChildren };
//# sourceMappingURL=renderDiffChildren.d.ts.map
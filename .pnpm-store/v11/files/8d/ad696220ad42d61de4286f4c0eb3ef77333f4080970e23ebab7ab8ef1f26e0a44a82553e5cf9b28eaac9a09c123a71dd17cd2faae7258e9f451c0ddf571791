import { FileContents } from "../../types.js";
import { GetHoveredLineResult } from "../../managers/InteractionManager.js";
import { FileProps } from "../types.js";
import { ReactNode } from "react";

//#region src/react/utils/renderFileChildren.d.ts
interface RenderFileChildrenProps<LAnnotation> {
  file: FileContents;
  renderCustomHeader: FileProps<LAnnotation>['renderCustomHeader'];
  renderHeaderPrefix: FileProps<LAnnotation>['renderHeaderPrefix'];
  renderHeaderMetadata: FileProps<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: FileProps<LAnnotation>['renderAnnotation'];
  lineAnnotations: FileProps<LAnnotation>['lineAnnotations'];
  renderGutterUtility: FileProps<LAnnotation>['renderGutterUtility'];
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
}
declare function renderFileChildren<LAnnotation>({
  file,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderMetadata,
  renderAnnotation,
  lineAnnotations,
  renderGutterUtility,
  getHoveredLine
}: RenderFileChildrenProps<LAnnotation>): ReactNode;
//#endregion
export { renderFileChildren };
//# sourceMappingURL=renderFileChildren.d.ts.map
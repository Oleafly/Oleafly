import { DiffLineAnnotation } from "../types.js";
import { CSSProperties, ReactNode } from "react";

//#region src/ssr/FileDiffReact.d.ts
interface FileDiffSsrProps<LAnnotation> {
  prerenderedHTML: string;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  className?: string;
  style?: CSSProperties;
}
declare function FileDiffSSR<LAnnotation>({
  prerenderedHTML,
  annotations,
  className,
  style,
  renderAnnotation
}: FileDiffSsrProps<LAnnotation>): React.JSX.Element;
//#endregion
export { FileDiffSSR };
//# sourceMappingURL=FileDiffReact.d.ts.map
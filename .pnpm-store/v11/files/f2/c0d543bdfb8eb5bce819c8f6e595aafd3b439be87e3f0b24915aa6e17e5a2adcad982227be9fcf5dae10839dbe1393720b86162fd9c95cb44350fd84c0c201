import { RenderRange } from "../types.js";

//#region src/utils/includesFileAnnotations.d.ts
declare const FILE_ANNOTATION_LINE_NUMBER = 0;
declare const FILE_ANNOTATION_HUNK_INDEX = -1;
declare const FILE_ANNOTATION_LINE_INDEX = -1;
declare const FILE_ANNOTATION_DOM_KEY: string;
type AnnotationLineMap<TAnnotation> = Record<number, TAnnotation[] | undefined>;
type FileLevelAnnotationLike = {
  lineNumber: number;
};
declare function includesFileAnnotations(annotations: readonly FileLevelAnnotationLike[] | undefined): boolean;
declare function getFileAnnotations<TAnnotation>(annotations: AnnotationLineMap<TAnnotation>): TAnnotation[] | undefined;
declare function shouldRenderFileAnnotations(renderRange: RenderRange): boolean;
//#endregion
export { FILE_ANNOTATION_DOM_KEY, FILE_ANNOTATION_HUNK_INDEX, FILE_ANNOTATION_LINE_INDEX, FILE_ANNOTATION_LINE_NUMBER, getFileAnnotations, includesFileAnnotations, shouldRenderFileAnnotations };
//# sourceMappingURL=includesFileAnnotations.d.ts.map
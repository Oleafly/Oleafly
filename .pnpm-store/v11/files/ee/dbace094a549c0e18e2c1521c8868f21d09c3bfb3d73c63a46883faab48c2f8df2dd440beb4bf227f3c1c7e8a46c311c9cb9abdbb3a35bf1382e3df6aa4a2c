import { CodeViewItem, CodeViewScrollTarget, DiffLineAnnotation, LineAnnotation } from "../types.js";
import { GetHoveredLineResult } from "../managers/InteractionManager.js";
import { CodeView as CodeView$1, CodeViewLineSelection, CodeViewOptions } from "../components/CodeView.js";
import { CSSProperties, ReactNode, Ref } from "react";

//#region src/react/CodeView.d.ts
type CodeViewGutterUtilityGetter = (() => GetHoveredLineResult<'file'> | undefined) | (() => GetHoveredLineResult<'diff'> | undefined);
interface CodeViewBaseProps<LAnnotation> {
  options?: CodeViewOptions<LAnnotation>;
  className?: string;
  style?: CSSProperties;
  containerRef?: Ref<HTMLDivElement>;
  disableWorkerPool?: boolean;
  selectedLines?: CodeViewLineSelection | null;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  onScroll?(scrollTop: number, viewer: CodeView$1<LAnnotation>): void;
  renderCustomHeader?(item: CodeViewItem<LAnnotation>): ReactNode;
  renderHeaderPrefix?(item: CodeViewItem<LAnnotation>): ReactNode;
  renderHeaderMetadata?(item: CodeViewItem<LAnnotation>): ReactNode;
  renderAnnotation?(annotation: LineAnnotation<LAnnotation> | DiffLineAnnotation<LAnnotation>, item: CodeViewItem<LAnnotation>): ReactNode;
  renderGutterUtility?(getHoveredLine: CodeViewGutterUtilityGetter, item: CodeViewItem<LAnnotation>): ReactNode;
}
interface ControlledCodeViewProps<LAnnotation> extends CodeViewBaseProps<LAnnotation> {
  items: readonly CodeViewItem<LAnnotation>[];
  initialItems?: never;
}
interface UncontrolledCodeViewProps<LAnnotation> extends CodeViewBaseProps<LAnnotation> {
  initialItems?: readonly CodeViewItem<LAnnotation>[];
  items?: never;
}
type CodeViewProps<LAnnotation = undefined> = ControlledCodeViewProps<LAnnotation> | UncontrolledCodeViewProps<LAnnotation>;
interface CodeViewHandle<LAnnotation> {
  addItems(items: readonly CodeViewItem<LAnnotation>[]): void;
  getItem(id: string): CodeViewItem<LAnnotation> | undefined;
  updateItem(item: CodeViewItem<LAnnotation>): boolean;
  updateItemId(oldId: string, newId: string): boolean;
  scrollTo(target: CodeViewScrollTarget): void;
  setSelectedLines(selection: CodeViewLineSelection | null): void;
  getSelectedLines(): CodeViewLineSelection | null;
  clearSelectedLines(): void;
  getInstance(): CodeView$1<LAnnotation> | undefined;
}
type CodeViewComponent = <LAnnotation = undefined>(props: CodeViewProps<LAnnotation> & {
  ref?: React.Ref<CodeViewHandle<LAnnotation>>;
}) => React.JSX.Element;
declare const CodeView: CodeViewComponent;
//#endregion
export { CodeView, CodeViewHandle, CodeViewProps, ControlledCodeViewProps, UncontrolledCodeViewProps };
//# sourceMappingURL=CodeView.d.ts.map
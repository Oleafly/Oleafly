import { AnnotationSide, DiffLineEventBaseProps, DiffTokenEventBaseProps, ExpansionDirections, LineEventBaseProps, MergeConflictResolution, SelectedLineRange, SelectionSide, TokenEventBase } from "../types.js";

//#region src/managers/InteractionManager.d.ts
type LogTypes = 'click' | 'move' | 'both' | 'none';
type InteractionManagerMode = 'file' | 'diff';
interface OnLineClickProps extends LineEventBaseProps {
  event: PointerEvent;
}
interface OnLineEnterLeaveProps extends LineEventBaseProps {
  event: PointerEvent;
}
interface OnDiffLineClickProps extends DiffLineEventBaseProps {
  event: PointerEvent;
}
interface OnDiffLineEnterLeaveProps extends DiffLineEventBaseProps {
  event: PointerEvent;
}
interface SelectionWriteOptions {
  notify?: boolean;
}
type GetLineIndexUtility = (lineNumber: number, side?: SelectionSide) => [number, number] | undefined;
type EventClickProps<TMode extends InteractionManagerMode> = TMode extends 'file' ? OnLineClickProps : OnDiffLineClickProps;
type PointerEventEnterLeaveProps<TMode extends InteractionManagerMode> = TMode extends 'file' ? OnLineEnterLeaveProps : OnDiffLineEnterLeaveProps;
type OnTokenEventProps<TMode extends InteractionManagerMode> = TMode extends 'file' ? TokenEventBase : DiffTokenEventBaseProps;
type GetHoveredLineResult<TMode extends InteractionManagerMode> = TMode extends 'file' ? {
  lineNumber: number;
} : {
  lineNumber: number;
  side: AnnotationSide;
};
interface MergeConflictActionTarget {
  kind: 'merge-conflict-action';
  resolution: MergeConflictResolution;
  conflictIndex: number;
}
interface InteractionManagerBaseOptions<TMode extends InteractionManagerMode> {
  lineHoverHighlight?: 'disabled' | 'both' | 'number' | 'line';
  enableTokenInteractionsOnWhitespace?: boolean;
  enableGutterUtility?: boolean;
  onGutterUtilityClick?(range: SelectedLineRange): unknown;
  onLineClick?(props: EventClickProps<TMode>): unknown;
  onLineNumberClick?(props: EventClickProps<TMode>): unknown;
  onLineEnter?(props: PointerEventEnterLeaveProps<TMode>): unknown;
  onLineLeave?(props: PointerEventEnterLeaveProps<TMode>): unknown;
  onTokenClick?(props: OnTokenEventProps<TMode>, event: MouseEvent): unknown;
  onTokenEnter?(props: OnTokenEventProps<TMode>, event: PointerEvent): unknown;
  onTokenLeave?(props: OnTokenEventProps<TMode>, event: PointerEvent): unknown;
  __debugPointerEvents?: LogTypes;
  enableLineSelection?: boolean;
  controlledSelection?: boolean;
  onLineSelected?: (range: SelectedLineRange | null) => void;
  onLineSelectionStart?: (range: SelectedLineRange | null) => void;
  onLineSelectionChange?: (range: SelectedLineRange | null) => void;
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void;
  getLineIndex?: GetLineIndexUtility;
}
interface InteractionManagerOptions<TMode extends InteractionManagerMode> extends InteractionManagerBaseOptions<TMode> {
  usesCustomGutterUtility?: boolean;
  onHunkExpand?(hunkIndex: number, direction: ExpansionDirections, expansionLineCountOverride?: number): unknown;
  onMergeConflictActionClick?(target: MergeConflictActionTarget): void;
}
declare class InteractionManager<TMode extends InteractionManagerMode> {
  private mode;
  private options;
  private hoveredLine;
  private hoveredToken;
  private pre;
  private gutterUtilityLine;
  private gutterUtilityContainer;
  private gutterUtilityButton;
  private gutterUtilitySlot;
  private interactiveLinesAttr;
  private interactiveLineNumbersAttr;
  private hasPointerListeners;
  private hasDocumentPointerListeners;
  private selectedRange;
  private proposedSelectedRange;
  private renderedSelectionRange;
  private selectionAnchor;
  private queuedSelectionRender;
  private pointerSession;
  constructor(mode: TMode, options: InteractionManagerOptions<TMode>);
  setOptions(options: InteractionManagerOptions<TMode>): void;
  cleanUp(): void;
  setup(pre: HTMLPreElement): void;
  setSelectionDirty(): void;
  isSelectionDirty(): boolean;
  setSelection(range: SelectedLineRange | null, options?: SelectionWriteOptions): void;
  getSelection(): SelectedLineRange | null;
  getHoveredLine: () => GetHoveredLineResult<TMode> | undefined;
  handlePointerClick: (event: MouseEvent) => void;
  handlePointerMove: (event: PointerEvent) => void;
  handlePointerLeave: (event: PointerEvent) => void;
  private handlePointerEvent;
  private syncPointerListeners;
  private updateInteractiveLineAttributes;
  private handlePointerDown;
  private startLineSelectionFromPointerDown;
  private startGutterSelectionFromPointerDown;
  private handleDocumentPointerMove;
  private handleDocumentPointerUp;
  private handleDocumentPointerCancel;
  private clearHoveredLine;
  private setHoveredLine;
  private clearHoveredToken;
  private setHoveredToken;
  private ensureGutterUtilityNode;
  private revealUtilityFromGutterPath;
  private placeUtility;
  private placeUtilityFromSelection;
  private showUtilityOnLine;
  private hideUtility;
  private currentSelectionEnds;
  private selectionEnds;
  private selectionPointRowIndex;
  private targetForSelectionPoint;
  private attachDocumentPointerListeners;
  private detachDocumentPointerListeners;
  private clearPointerSession;
  private clearPendingSingleLineState;
  private selectionInfoFromPath;
  private resolveSelectionInfo;
  private selectionPointFromPath;
  private resolveSelectionPoint;
  private resolveSelectionPath;
  private pathFromCoordinates;
  private pathFromEventPath;
  private pathFromElement;
  private pathFromAnnotationSlot;
  private hitTest;
  private getLineIndex;
  private getCurrentSelectionRange;
  private clearProposedSelection;
  private updateSelection;
  private getIndexesFromSelection;
  private renderSelection;
  private notifySelectionCommitted;
  private notifySelectionChangeDelta;
  private notifySelectionStart;
  private notifySelectionEnd;
  private toEventBaseProps;
  private toTokenEventBaseProps;
  private buildSelectedLineRange;
  private buildSelectionRange;
  private resolvePointerTarget;
  private isSplitDiff;
  private parseLineIndex;
}
type InteractionPluckOptions<TMode extends InteractionManagerMode> = InteractionManagerBaseOptions<TMode> & {
  renderGutterUtility?(getHoveredRow: () => GetHoveredLineResult<TMode> | undefined): HTMLElement | null | undefined;
};
declare function pluckInteractionOptions<TMode extends InteractionManagerMode>({
  enableTokenInteractionsOnWhitespace,
  enableGutterUtility,
  lineHoverHighlight,
  onGutterUtilityClick,
  onLineClick,
  onLineEnter,
  onLineLeave,
  onLineNumberClick,
  onTokenClick,
  onTokenEnter,
  onTokenLeave,
  renderGutterUtility,
  __debugPointerEvents,
  enableLineSelection,
  controlledSelection,
  onLineSelected,
  onLineSelectionStart,
  onLineSelectionChange,
  onLineSelectionEnd
}: InteractionPluckOptions<TMode>, onHunkExpand?: (hunkIndex: number, direction: ExpansionDirections, expansionLineCountOverride?: number) => unknown, getLineIndex?: GetLineIndexUtility, onMergeConflictActionClick?: (target: MergeConflictActionTarget) => void): InteractionManagerOptions<TMode>;
//#endregion
export { GetHoveredLineResult, GetLineIndexUtility, InteractionManager, InteractionManagerBaseOptions, InteractionManagerMode, InteractionManagerOptions, LogTypes, MergeConflictActionTarget, OnDiffLineClickProps, OnDiffLineEnterLeaveProps, OnLineClickProps, OnLineEnterLeaveProps, OnTokenEventProps, SelectionWriteOptions, pluckInteractionOptions };
//# sourceMappingURL=InteractionManager.d.ts.map
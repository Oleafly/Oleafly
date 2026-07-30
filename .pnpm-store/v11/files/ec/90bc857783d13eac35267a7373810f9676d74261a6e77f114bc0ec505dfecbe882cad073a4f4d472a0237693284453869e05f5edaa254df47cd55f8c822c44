import { CodeViewDiffItem, CodeViewFileItem, CodeViewItem, CodeViewLayout, CodeViewScrollTarget, HunkSeparators, SelectedLineRange, SmoothScrollSettings, VirtualFileMetrics, VirtualWindowSpecs } from "../types.js";
import { SelectionWriteOptions } from "../managers/InteractionManager.js";
import { WorkerPoolManager } from "../worker/WorkerPoolManager.js";
import { FileOptions } from "./File.js";
import { FileDiffOptions } from "./FileDiff.js";
import { VirtualizerConfig } from "./Virtualizer.js";
import { VirtualizedFile } from "./VirtualizedFile.js";
import { VirtualizedFileDiff } from "./VirtualizedFileDiff.js";

//#region src/components/CodeView.d.ts
interface AdvancedVirtualizedBaseItem {
  /** Current index of this record in the ordered items array. */
  index: number;
  /** Absolute top offset of this item inside the scroll content. */
  top: number;
  /** Total measured height reserved for this item. */
  height: number;
  /** Root <diffs-container> node currently mounted for this item, only exists
   * when rendered. */
  element: HTMLElement | undefined;
  /** Last controlled version observed for this record. */
  version: number | undefined;
  /** Last CodeView option revision this item rendered with. */
  renderedOptionsRevision: number;
}
interface CodeViewDiffItemContext<LAnnotation> extends AdvancedVirtualizedBaseItem {
  type: 'diff';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewDiffItem<LAnnotation>;
  /** Virtualized diff instance responsible for rendering this item. */
  instance: VirtualizedFileDiff<LAnnotation>;
}
interface CodeViewFileItemContext<LAnnotation> extends AdvancedVirtualizedBaseItem {
  type: 'file';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewFileItem<LAnnotation>;
  /** Virtualized file instance responsible for rendering this item. */
  instance: VirtualizedFile<LAnnotation>;
}
interface CodeViewRenderedDiffItem<LAnnotation> {
  id: string;
  type: 'diff';
  item: CodeViewDiffItem<LAnnotation>;
  version: number | undefined;
  element: HTMLElement;
  instance: VirtualizedFileDiff<LAnnotation>;
}
interface CodeViewRenderedFileItem<LAnnotation> {
  id: string;
  type: 'file';
  item: CodeViewFileItem<LAnnotation>;
  version: number | undefined;
  element: HTMLElement;
  instance: VirtualizedFile<LAnnotation>;
}
type CodeViewRenderedItem<LAnnotation> = CodeViewRenderedDiffItem<LAnnotation> | CodeViewRenderedFileItem<LAnnotation>;
interface CodeViewLineSelection {
  id: string;
  range: SelectedLineRange;
}
interface CodeViewCoordinator<LAnnotation> {
  hasHeaderRenderers: boolean;
  hasAnnotationRenderer: boolean;
  hasGutterRenderer: boolean;
  onSnapshotChange(snapshot: CodeViewRenderedItem<LAnnotation>[] | undefined): void;
}
type CodeViewScrollListener<LAnnotation> = (scrollTop: number, viewer: CodeView<LAnnotation>) => void;
type OverloadCallbackArgs<TCallback> = TCallback extends ((...args: infer TArgs) => unknown) ? TArgs : never;
type CallbackReturn<TCallback> = TCallback extends ((...args: never[]) => infer TReturn) ? TReturn : never;
type OverloadFileCallbackArgs<LAnnotation, TKey extends keyof FileOptions<LAnnotation>> = OverloadCallbackArgs<NonNullable<FileOptions<LAnnotation>[TKey]>>;
type OverloadDiffCallbackArgs<LAnnotation, TKey extends keyof FileDiffOptions<LAnnotation>> = OverloadCallbackArgs<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;
type CodeViewOptionCallback<LAnnotation, TKey extends keyof FileOptions<LAnnotation> & keyof FileDiffOptions<LAnnotation>> = {
  (...args: [...OverloadFileCallbackArgs<LAnnotation, TKey>, context: CodeViewFileItemContext<LAnnotation>]): CallbackReturn<NonNullable<FileOptions<LAnnotation>[TKey]>>;
  (...args: [...OverloadDiffCallbackArgs<LAnnotation, TKey>, context: CodeViewDiffItemContext<LAnnotation>]): CallbackReturn<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;
};
declare const CODE_VIEW_DIFF_OPTION_KEYS: readonly ['theme', 'disableLineNumbers', 'overflow', 'themeType', 'disableFileHeader', 'disableVirtualizationBuffers', 'preferredHighlighter', 'useCSSClasses', 'useTokenTransformer', 'tokenizeMaxLineLength', 'tokenizeMaxLength', 'unsafeCSS', 'diffStyle', 'diffIndicators', 'disableBackground', 'expandUnchanged', 'collapsedContextThreshold', 'lineDiffType', 'maxLineDiffLength', 'expansionLineCount', 'lineHoverHighlight', 'enableTokenInteractionsOnWhitespace', 'enableGutterUtility', '__debugPointerEvents', 'enableLineSelection', 'controlledSelection', 'disableErrorHandling'];
type CodeViewDiffOptionKeys = (typeof CODE_VIEW_DIFF_OPTION_KEYS)[number];
type CodeViewPassThroughOptions<LAnnotation> = Pick<FileDiffOptions<LAnnotation>, CodeViewDiffOptionKeys>;
declare const CODE_VIEW_SHARED_CALLBACK_KEYS: readonly ['renderCustomHeader', 'renderHeaderPrefix', 'renderHeaderMetadata', 'renderAnnotation', 'renderGutterUtility', 'onPostRender', 'onGutterUtilityClick', 'onLineClick', 'onLineNumberClick', 'onLineEnter', 'onLineLeave', 'onTokenClick', 'onTokenEnter', 'onTokenLeave'];
declare const CODE_VIEW_SELECTION_CALLBACK_KEYS: readonly ['onLineSelected', 'onLineSelectionStart', 'onLineSelectionChange', 'onLineSelectionEnd'];
type CodeViewSharedCallbackKeys = (typeof CODE_VIEW_SHARED_CALLBACK_KEYS)[number];
type CodeViewSelectionCallbackKeys = (typeof CODE_VIEW_SELECTION_CALLBACK_KEYS)[number];
type CodeViewSharedCallbackOptions<LAnnotation> = { [TKey in CodeViewSharedCallbackKeys]?: CodeViewOptionCallback<LAnnotation, TKey> };
type CodeViewSelectionCallbackOptions<LAnnotation> = { [TKey in CodeViewSelectionCallbackKeys]?: CodeViewOptionCallback<LAnnotation, TKey> };
interface CodeViewOptions<LAnnotation> extends CodeViewPassThroughOptions<LAnnotation>, CodeViewSharedCallbackOptions<LAnnotation>, CodeViewSelectionCallbackOptions<LAnnotation> {
  hunkSeparators?: Exclude<HunkSeparators, 'custom'>;
  itemMetrics?: Partial<VirtualFileMetrics>;
  pointerEventsOnScroll?: boolean;
  smoothScrollSettings?: SmoothScrollSettings;
  stickyHeaders?: boolean;
  controlledSelection?: boolean;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  layout?: CodeViewLayout;
  /** Internal dev-only check to ensure your `itemMetrics` are correct.  Its
   * automatically disabled in a production build because it will hurt
   * performance fairly significantly */
  __devOnlyValidateItemHeights?: boolean;
}
declare class CodeView<LAnnotation = undefined> {
  static __STOP: boolean;
  static __lastScrollPosition: number;
  type: 'advanced';
  readonly config: VirtualizerConfig;
  private items;
  private idToItem;
  private selectedLines;
  private instanceToItem;
  private layoutDirtyIndex;
  private pendingLayoutReset;
  private renderOptionsRevision;
  private slotCoordinator;
  private slotSnapshot;
  private scrollListeners;
  private scrollHeight;
  private containerHeight;
  private scrollTop;
  private scrollPageOffset;
  private scrollDirty;
  private scrollInteractionFixTimer;
  private pointerEventsDisabled;
  private codeOverflowFix;
  private height;
  private heightDirty;
  private windowSpecs;
  private renderState;
  private itemMetricsCache;
  private readonly fileOptionsPrototype;
  private readonly diffOptionsPrototype;
  private pendingScrollTarget;
  private pendingLayoutAnchor;
  private shouldFixContainerFocus;
  private scrollAnimation;
  private root;
  private resizeObserver;
  private container;
  private stickyContainer;
  private stickyOffset;
  private elementPool;
  private elementPoolVersion;
  private elementPoolTracker;
  private pendingElementPool;
  private options;
  private workerManager;
  private isContainerManaged;
  constructor(options?: CodeViewOptions<LAnnotation>, workerManager?: WorkerPoolManager | undefined, isContainerManaged?: boolean);
  private getLayout;
  private computeMetricsCache;
  private getSmoothScrollSettings;
  private shouldDisablePointerEvents;
  private shouldValidateItemHeights;
  private validateRenderedItemHeight;
  private validateStickyContainerHeight;
  private clearScrollInteractionTimer;
  private suspendScrollInteractions;
  private restoreScrollInteractions;
  private syncLayout;
  setup(root: HTMLElement): void;
  reset(): void;
  cleanUp(): void;
  private cleanAllRenderedItems;
  private primeScrollTarget;
  private getElementPoolLimit;
  private acquireElement;
  private releaseRenderedItem;
  private renderedItemOwnsFocus;
  private fixContainerFocus;
  private cleanElement;
  private queueElementForPool;
  private promotePendingPooledElements;
  private isElementClean;
  private getElementPoolSize;
  private clearElementPool;
  private invalidateElementPool;
  private markElementPoolGenerationCurrent;
  private isElementPoolGenerationCurrent;
  private resolveEffectiveScrollBehavior;
  scrollTo(target: CodeViewScrollTarget): void;
  setSelectedLines(selection: CodeViewLineSelection | null, options?: SelectionWriteOptions): void;
  getSelectedLines(): CodeViewLineSelection | null;
  clearSelectedLines(options?: SelectionWriteOptions): void;
  getItem(itemId: string): CodeViewItem<LAnnotation> | undefined;
  updateItem(input: CodeViewItem<LAnnotation>): boolean;
  updateItemId(oldId: string, newId: string): boolean;
  addItem(input: CodeViewItem<LAnnotation>): void;
  addItems(inputs: readonly CodeViewItem<LAnnotation>[]): void;
  setItems(items: readonly CodeViewItem<LAnnotation>[]): void;
  /**
   * Append new records to the viewer while preserving existing layout state.
   * This is the shared path for imperative adds and the append-only reconcile
   * fast path, so it measures new items immediately and only triggers render
   * once at the end.
   */
  private appendItemsInternal;
  private canSkipRenderForAppend;
  onThemeChange(): void;
  setOptions(options: CodeViewOptions<LAnnotation> | undefined): void;
  private capturePendingLayoutAnchor;
  render(immediate?: boolean): void;
  instanceChanged(instance: VirtualizedFile<LAnnotation> | VirtualizedFileDiff<LAnnotation>, layoutDirty: boolean): void;
  getWindowSpecs(): VirtualWindowSpecs;
  getContainerElement(): HTMLElement | undefined;
  getRenderedItems(): CodeViewRenderedItem<LAnnotation>[];
  setSlotCoordinator(coordinator?: CodeViewCoordinator<LAnnotation>): boolean;
  getSlotSnapshot(coordinator: CodeViewCoordinator<LAnnotation>): CodeViewRenderedItem<LAnnotation>[] | undefined;
  subscribeToScroll(listener: CodeViewScrollListener<LAnnotation>): () => void;
  getLocalTopForInstance(instance: VirtualizedFile<LAnnotation> | VirtualizedFileDiff<LAnnotation>): number;
  getTopForItem(id: string): number | undefined;
  private createItem;
  private applySelectedLines;
  private syncSelection;
  private renamePendingScrollTarget;
  private renamePendingLayoutAnchor;
  private createFileOptionsPrototype;
  private createDiffOptionsPrototype;
  private createFileOptions;
  private createDiffOptions;
  private updateItemOptionsId;
  private getItemOptions;
  private defineItemSharedCallback;
  private defineItemSelectionCallback;
  /**
   * Track the earliest index whose measured layout may now be stale. Later
   * render passes relayout from this point forward so we do not have to rebuild
   * positions for the whole list after every change.
   */
  private markLayoutDirtyFromIndex;
  /**
   * Mark the earliest affected item as layout-dirty after an imperative change.
   * Each record carries its current array index so this stays O(1) even when
   * the viewer holds a very large number of items.
   */
  private markItemLayoutDirty;
  /**
   * Detect the common controlled-update case where the new list simply extends
   * the existing ordered prefix. When that happens we can reuse every current
   * record in place, sync any versioned payload changes, and append only the new
   * tail instead of rebuilding the whole list.
   */
  private tryAppendItems;
  /**
   * Reconcile a new controlled item list against the existing records by id.
   * This reuses records and instances when type matches, cleans up removed
   * records, rebuilds the lookup maps, and marks layout dirty whenever order,
   * membership, or versioned item data changes.
   */
  private reconcileItems;
  /**
   * Update a reused record from the latest controlled item only when its item
   * version changes. Matching versions mean CodeView keeps the current record
   * snapshot, which lets imperative updates remain in place until the caller
   * intentionally publishes a newer version.
   */
  private syncItemRecord;
  private getMaxScrollTopForHeight;
  private getMaxScrollTop;
  private shouldRebaseScroll;
  private getPagedScrollHeight;
  private getMaxPagedScrollTop;
  private clampPagedScrollTop;
  /**
   * Clamps a logical scroll position to the min/max allowable scroll range
   * based on the full computed content height.
   */
  private clampScrollTop;
  private getMaxScrollPageOffset;
  private clampScrollPageOffset;
  private resolveScrollPageWindow;
  /**
   * Resolve how a logical scrollTop maps onto the reusable paged scroll window
   * without mutating the current page offset.
   */
  private resolvePagedScrollPosition;
  private needsScrollPageUpdate;
  private getPagedLayoutTop;
  private getStickyHeaderOffset;
  private getScrollTargetRect;
  private normalizeScrollTarget;
  /**
   * Resolve a target's scroll position
      * Returns `undefined` when we can't resolve a target for whatever reason
   */
  private resolveScrollTargetTop;
  /**
   * Given an existing scroll target (scroll top and height), figure out the
   * correct scroll position to target based on the desired alignment, offset
   * and stickyOffset if necessary
   */
  private resolveAlignedScrollPosition;
  private getLineScrollPosition;
  private getRangeScrollPosition;
  /**
   * Determine target scroll position for current frame.
   *
   * If there's no pendingScrollTarget then we just return the current scroll
   * position
   *
   * If there's a pendingScrollTarget then we depend on whether there's a
   * smooth scroll animation or not. If not just return the destination, or
   * compute next position given the smooth scroll spring physics
   */
  private computeTargetScrollTopForFrame;
  /**
   * Closed-form critical-damped ODE step.
   *
   * Stable at any dt (Euler would blow up once ω·dt ≳ 1), so this survives
   * big RAF gaps (tab-wake, offscreen frames) and resize-driven ticks that
   * fire outside the normal RAF cadence.
   */
  private computeSpringStep;
  /**
   * For any given pendingScrollTarget, updates any in flight smooth scroll
   * animations and returns the target scrollTop to move towards
   *
   * Resolves the animation based on frame time and adopts any necessary scroll
   * anchoring corrections if necessary
   */
  private advanceScrollAnimation;
  private computeRenderRangeAndEmit;
  private flushManagers;
  private syncContainerHeight;
  private getStickyBounds;
  private applyStickyPositioning;
  private syncPagedScrollScaffolding;
  private reconcileRenderedItems;
  private updateStickyPositioning;
  private handleScroll;
  private clearPendingScroll;
  private handleResize;
  /**
   * Figure out scrollTop accounting for sticky header if enabled and
   * necessary
   */
  private getScrollAnchorViewportTop;
  /**
   * Attempt to find a scroll anchor based on build in metrics of the existing
   * rendered files/diff.
   *
   * A scroll anchor represents the first fully visible element (in other
   * words, the first file or first line who's top is fully in the viewport).
   */
  private getScrollAnchor;
  /**
   * Given a scroll anchor, attempt to resolve a newly updated (and clamped)
   * scroll position to keep the anchored element in place.
   *
   * If we can't resolve a position for whatever reason, we'll return
   * undefined.
   */
  private resolveAnchoredScrollTop;
  /**
   * Apply a device-pixel-rounded scroll position if it differs from the last
   * logical scrollTop synchronized into the paged scroll scaffold.
   */
  private applyScrollFix;
  /**
   * Decide whether a pending programmatic scroll has reached its
   * destination and should be cleared.
   */
  private isPendingTargetSettled;
  getScrollTop(): number;
  getHeight(): number;
  getScrollHeight(): number;
  private flushSlotCoordinator;
  private notifyScroll;
  /**
   * Find the first item whose bottom edge crosses into the viewport window.
   * This lets scroll-time rendering jump directly near the visible range instead
   * of linearly scanning from the start of very large item lists.
   */
  private findFirstVisibleIndex;
  /**
   * Find the last item whose top edge is still within the viewport window.
   * Paired with findFirstVisibleIndex, this bounds the render loop to only the
   * slice of items that can actually intersect the current scroll range.
   */
  private findLastVisibleIndex;
  /**
   * Recompute measured tops and heights starting from the earliest dirty item.
   * Earlier items keep their existing layout, while everything from startIndex
   * onward is remeasured so downstream positions and total scroll height stay
   * consistent after inserts, removals, or versioned item updates.
   */
  private recomputeLayout;
  private resetRenderState;
  private getFitPerfectlyOverscroll;
}
//#endregion
export { CodeView, CodeViewCoordinator, CodeViewLineSelection, CodeViewOptions, CodeViewRenderedDiffItem, CodeViewRenderedFileItem, CodeViewRenderedItem, CodeViewScrollListener };
//# sourceMappingURL=CodeView.d.ts.map
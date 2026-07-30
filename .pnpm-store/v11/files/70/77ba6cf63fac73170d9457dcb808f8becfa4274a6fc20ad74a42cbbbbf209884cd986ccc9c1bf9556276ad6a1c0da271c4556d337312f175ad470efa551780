import { FileContents, FileDiffMetadata, HunkExpansionRegion, RenderDiffOptions, RenderDiffResult, RenderFileOptions, RenderFileResult, SupportedLanguages, ThemedDiffResult, ThemedFileResult } from "../types.js";
import { DiffRendererInstance, FileRendererInstance, WorkerInitializationRenderOptions, WorkerPoolOptions, WorkerRenderingOptions, WorkerStats } from "./types.js";
import LRUMapPkg from "lru_map";

//#region src/worker/WorkerPoolManager.d.ts
interface GetCachesResult {
  fileCache: LRUMapPkg.LRUMap<string, RenderFileResult>;
  diffCache: LRUMapPkg.LRUMap<string, RenderDiffResult>;
}
interface ThemeSubscriber {
  onThemeChange(): void;
}
type RenderTaskInstance = FileRendererInstance | DiffRendererInstance;
declare class WorkerPoolManager {
  private options;
  private highlighter;
  private readonly preferredHighlighter;
  private renderOptions;
  private renderOptionsRequestVersion;
  private renderOptionsVersion;
  private initialized;
  private workers;
  private queuedTasks;
  private queuedTaskByInstance;
  private taskByHighlightKey;
  private activeTaskById;
  private activeRequestByInstance;
  private nextRequestId;
  private themeSubscribers;
  private workersFailed;
  private statSubscribers;
  private fileCache;
  private diffCache;
  private _queuedBroadcast;
  private lifecycleGeneration;
  constructor(options: WorkerPoolOptions, {
    langs,
    theme,
    useTokenTransformer,
    lineDiffType,
    maxLineDiffLength,
    tokenizeMaxLineLength,
    preferredHighlighter
  }: WorkerInitializationRenderOptions);
  isWorkingPool(): boolean;
  getFileResultCache(file: FileContents): RenderFileResult | undefined;
  getDiffResultCache(diff: FileDiffMetadata): RenderDiffResult | undefined;
  inspectCaches(): GetCachesResult;
  evictFileFromCache(cacheKey: string): boolean;
  evictDiffFromCache(cacheKey: string): boolean;
  setRenderOptions({
    theme,
    useTokenTransformer,
    lineDiffType,
    maxLineDiffLength,
    tokenizeMaxLineLength
  }: Partial<WorkerRenderingOptions>): Promise<void>;
  getFileRenderOptions(): RenderFileOptions;
  getDiffRenderOptions(): RenderDiffOptions;
  private setRenderOptionsOnWorkers;
  subscribeToThemeChanges(instance: ThemeSubscriber): () => void;
  unsubscribeToThemeChanges(instance: ThemeSubscriber): void;
  subscribeToStatChanges(callback: (stats: WorkerStats) => unknown): () => void;
  private queueBroadcastStateChanges;
  private _broadcastStateChanges;
  cleanUpTasks(instance: RenderTaskInstance): void;
  isInitialized(): boolean;
  initialize(languages?: SupportedLanguages[]): Promise<void>;
  private initializeWorkers;
  private drainQueue;
  highlightFileAST(instance: FileRendererInstance, file: FileContents): void;
  primeFileHighlightCache(file: FileContents): void;
  getPlainFileAST(file: FileContents, startingLine: number, totalLines: number, lines?: string[]): ThemedFileResult | undefined;
  highlightDiffAST(instance: DiffRendererInstance, diff: FileDiffMetadata): void;
  primeDiffHighlightCache(diff: FileDiffMetadata): void;
  getPlainDiffAST(diff: FileDiffMetadata, startingLine: number, totalLines: number, expandedHunks?: Map<number, HunkExpansionRegion> | true, collapsedContextThreshold?: number): ThemedDiffResult | undefined;
  terminate(): void;
  private isCurrentLifecycle;
  private queueInitialization;
  private cancelActiveWorkerTasks;
  private terminateWorkers;
  getStats(): WorkerStats;
  private submitTask;
  private submitCacheTask;
  private enqueueRenderTask;
  private resolveLanguagesAndExecuteTask;
  private handleWorkerMessage;
  private _queuedDrain;
  private queueDrain;
  private assignWorkerToTask;
  private cleanWorkerAndTask;
  private executeTask;
  private maybeAttachCustomExtensions;
  private syncCustomExtensionVersion;
  private getAvailableWorker;
  private getFileHighlightKey;
  private getDiffHighlightKey;
  private getHighlightKeyForRequest;
  private hasActiveRequest;
  private addInstanceToTask;
  private detachInstanceFromQueuedTasks;
  private detachInstanceFromRenderTask;
  private removeQueuedTask;
  private removeActiveTask;
  private invalidateRenderTasks;
  private clearQueuedInstanceRequests;
  private clearHighlightKey;
  private trackInstanceRequests;
  private clearInstanceRequests;
  private notifyFileInstances;
  private notifyDiffInstances;
  private notifyHighlightError;
  private hasMatchingFileInstanceTask;
  private hasMatchingDiffInstanceTask;
  private getTaskByHighlightKey;
  private isCurrentRenderTask;
  private iterateRenderTasks;
  private generateRequestId;
}
//#endregion
export { WorkerPoolManager };
//# sourceMappingURL=WorkerPoolManager.d.ts.map
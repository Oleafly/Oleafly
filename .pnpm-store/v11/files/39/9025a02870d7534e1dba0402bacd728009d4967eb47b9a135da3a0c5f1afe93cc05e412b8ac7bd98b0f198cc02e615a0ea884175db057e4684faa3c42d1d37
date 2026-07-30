import { DEFAULT_THEMES } from "../constants.js";
import { areThemesEqual } from "../utils/areThemesEqual.js";
import { attachResolvedThemes } from "../highlighter/themes/attachResolvedThemes.js";
import { getSharedHighlighter } from "../highlighter/shared_highlighter.js";
import { getThemes } from "../utils/getThemes.js";
import { hasResolvedThemes } from "../highlighter/themes/hasResolvedThemes.js";
import { areFileRenderOptionsEqual } from "../utils/areFileRenderOptionsEqual.js";
import { areFilesEqual } from "../utils/areFilesEqual.js";
import { getCustomExtensionsMap, getCustomExtensionsVersion, getFiletypeFromFileName } from "../utils/getFiletypeFromFileName.js";
import { isFilePlainText } from "../utils/isFilePlainText.js";
import { renderFileWithHighlighter } from "../utils/renderFileWithHighlighter.js";
import { areDiffTargetsEqual } from "../utils/areDiffTargetsEqual.js";
import { areDiffRenderOptionsEqual } from "../utils/areDiffRenderOptionsEqual.js";
import { isDiffPlainText } from "../utils/isDiffPlainText.js";
import { renderDiffWithHighlighter } from "../utils/renderDiffWithHighlighter.js";
import { getResolvedLanguages } from "../highlighter/languages/getResolvedLanguages.js";
import { hasResolvedLanguages } from "../highlighter/languages/hasResolvedLanguages.js";
import { resolveLanguages } from "../highlighter/languages/resolveLanguages.js";
import { getResolvedThemes } from "../highlighter/themes/getResolvedThemes.js";
import { resolveThemes } from "../highlighter/themes/resolveThemes.js";
import LRUMapPkg from "lru_map";
//#region src/worker/WorkerPoolManager.ts
const IGNORE_RESPONSE = Symbol("IGNORE_RESPONSE");
var WorkerPoolTerminatedError = class extends Error {
	constructor() {
		super("WorkerPoolManager: operation canceled because the pool terminated");
	}
};
var WorkerPoolManager = class {
	options;
	highlighter;
	preferredHighlighter;
	renderOptions;
	renderOptionsRequestVersion = 0;
	renderOptionsVersion = 0;
	initialized = false;
	workers = [];
	queuedTasks = [];
	queuedTaskByInstance = /* @__PURE__ */ new Map();
	taskByHighlightKey = /* @__PURE__ */ new Map();
	activeTaskById = /* @__PURE__ */ new Map();
	activeRequestByInstance = /* @__PURE__ */ new Map();
	nextRequestId = 0;
	themeSubscribers = /* @__PURE__ */ new Set();
	workersFailed = false;
	statSubscribers = /* @__PURE__ */ new Set();
	fileCache;
	diffCache;
	_queuedBroadcast;
	lifecycleGeneration = 0;
	constructor(options, { langs, theme = DEFAULT_THEMES, useTokenTransformer = false, lineDiffType = "word-alt", maxLineDiffLength = 1e3, tokenizeMaxLineLength = 1e3, preferredHighlighter = "shiki-js" }) {
		this.options = options;
		this.preferredHighlighter = preferredHighlighter;
		this.renderOptions = {
			theme,
			useTokenTransformer,
			lineDiffType,
			maxLineDiffLength,
			tokenizeMaxLineLength
		};
		this.fileCache = new LRUMapPkg.LRUMap(options.totalASTLRUCacheSize ?? 100);
		this.diffCache = new LRUMapPkg.LRUMap(options.totalASTLRUCacheSize ?? 100);
		this.queueInitialization(langs);
	}
	isWorkingPool() {
		return !this.workersFailed;
	}
	getFileResultCache(file) {
		return file.cacheKey != null ? this.fileCache.get(file.cacheKey) : void 0;
	}
	getDiffResultCache(diff) {
		return diff.cacheKey != null ? this.diffCache.get(diff.cacheKey) : void 0;
	}
	inspectCaches() {
		const { fileCache, diffCache } = this;
		return {
			fileCache,
			diffCache
		};
	}
	evictFileFromCache(cacheKey) {
		try {
			return this.fileCache.delete(cacheKey) !== void 0;
		} finally {
			this.queueBroadcastStateChanges();
		}
	}
	evictDiffFromCache(cacheKey) {
		try {
			return this.diffCache.delete(cacheKey) !== void 0;
		} finally {
			this.queueBroadcastStateChanges();
		}
	}
	async setRenderOptions({ theme = this.renderOptions.theme ?? DEFAULT_THEMES, useTokenTransformer = this.renderOptions.useTokenTransformer ?? false, lineDiffType = this.renderOptions.lineDiffType ?? "word-alt", maxLineDiffLength = this.renderOptions.maxLineDiffLength ?? 1e3, tokenizeMaxLineLength = this.renderOptions.tokenizeMaxLineLength ?? 1e3 }) {
		const { lifecycleGeneration } = this;
		const renderOptionsRequestVersion = ++this.renderOptionsRequestVersion;
		const isCurrentRequest = () => this.isCurrentLifecycle(lifecycleGeneration) && this.renderOptionsRequestVersion === renderOptionsRequestVersion;
		try {
			const newRenderOptions = {
				theme,
				useTokenTransformer,
				lineDiffType,
				maxLineDiffLength,
				tokenizeMaxLineLength
			};
			if (!this.isInitialized()) await this.initialize();
			if (!isCurrentRequest() || areDiffRenderOptionsEqual(newRenderOptions, this.renderOptions)) return;
			const themeNames = getThemes(theme);
			let resolvedThemes = [];
			if (!areThemesEqual(newRenderOptions.theme, this.renderOptions.theme)) if (hasResolvedThemes(themeNames)) resolvedThemes = getResolvedThemes(themeNames);
			else resolvedThemes = await resolveThemes(themeNames);
			if (!isCurrentRequest()) return;
			if (this.highlighter != null) attachResolvedThemes(resolvedThemes, this.highlighter);
			else {
				const highlighter = await getSharedHighlighter({
					themes: themeNames,
					langs: ["text"],
					preferredHighlighter: this.preferredHighlighter
				});
				if (!isCurrentRequest()) return;
				this.highlighter = highlighter;
			}
			const workerSetup = this.setRenderOptionsOnWorkers(newRenderOptions, resolvedThemes);
			this.renderOptions = newRenderOptions;
			this.renderOptionsVersion++;
			this.diffCache.clear();
			this.fileCache.clear();
			this.invalidateRenderTasks();
			for (const instance of this.themeSubscribers) instance.onThemeChange();
			await workerSetup;
		} catch (error) {
			if (error instanceof WorkerPoolTerminatedError || !isCurrentRequest()) return;
			throw error;
		}
	}
	getFileRenderOptions() {
		const { tokenizeMaxLineLength, theme, useTokenTransformer } = this.renderOptions;
		return {
			theme,
			useTokenTransformer,
			tokenizeMaxLineLength
		};
	}
	getDiffRenderOptions() {
		return { ...this.renderOptions };
	}
	async setRenderOptionsOnWorkers(renderOptions, resolvedThemes) {
		if (this.workersFailed) return;
		if (!this.isInitialized()) await this.initialize();
		const taskPromises = [];
		for (const managedWorker of this.workers) {
			if (!managedWorker.initialized) {
				console.log({ managedWorker });
				throw new Error("setRenderOptionsOnWorkers: Somehow we have an uninitialized worker");
			}
			taskPromises.push(new Promise((resolve, reject) => {
				const id = this.generateRequestId();
				const task = {
					type: "set-render-options",
					id,
					request: {
						type: "set-render-options",
						id,
						renderOptions,
						resolvedThemes
					},
					resolve,
					reject,
					requestStart: Date.now()
				};
				this.activeTaskById.set(id, task);
				managedWorker.pendingSetupRequestId = id;
				managedWorker.worker.postMessage(task.request);
			}));
		}
		await Promise.all(taskPromises);
	}
	subscribeToThemeChanges(instance) {
		this.themeSubscribers.add(instance);
		this.queueBroadcastStateChanges();
		return () => {
			this.unsubscribeToThemeChanges(instance);
			this.queueBroadcastStateChanges();
		};
	}
	unsubscribeToThemeChanges(instance) {
		this.themeSubscribers.delete(instance);
		this.queueBroadcastStateChanges();
	}
	subscribeToStatChanges(callback) {
		this.statSubscribers.add(callback);
		callback(this.getStats());
		return () => {
			this.statSubscribers.delete(callback);
		};
	}
	queueBroadcastStateChanges() {
		if (this._queuedBroadcast != null) return;
		this._queuedBroadcast = requestAnimationFrame(this._broadcastStateChanges);
	}
	_broadcastStateChanges = () => {
		if (this._queuedBroadcast != null) {
			cancelAnimationFrame(this._queuedBroadcast);
			this._queuedBroadcast = void 0;
		}
		const stats = this.getStats();
		for (const callback of this.statSubscribers) callback(stats);
	};
	cleanUpTasks(instance) {
		this.detachInstanceFromQueuedTasks(instance);
		const requestId = this.activeRequestByInstance.get(instance);
		if (requestId != null) {
			const task = this.activeTaskById.get(requestId);
			if (isRenderTask(task)) {
				this.detachInstanceFromRenderTask(task, instance);
				if (!task.primeCache && task.instances.size === 0) this.removeActiveTask(task);
			} else this.activeTaskById.delete(requestId);
		}
		this.activeRequestByInstance.delete(instance);
		this.queueBroadcastStateChanges();
	}
	isInitialized() {
		return this.initialized === true;
	}
	async initialize(languages = []) {
		if (this.initialized === true) return;
		else if (this.initialized === false) {
			const { lifecycleGeneration } = this;
			this.initialized = new Promise((resolve, reject) => {
				(async () => {
					try {
						const themes = getThemes(this.renderOptions.theme);
						let resolvedThemes = [];
						if (hasResolvedThemes(themes)) resolvedThemes = getResolvedThemes(themes);
						else resolvedThemes = await resolveThemes(themes);
						if (!this.isCurrentLifecycle(lifecycleGeneration)) {
							resolve();
							return;
						}
						let resolvedLanguages = [];
						if (hasResolvedLanguages(languages)) resolvedLanguages = getResolvedLanguages(languages);
						else resolvedLanguages = await resolveLanguages(languages);
						if (!this.isCurrentLifecycle(lifecycleGeneration)) {
							resolve();
							return;
						}
						const [highlighter] = await Promise.all([getSharedHighlighter({
							themes,
							langs: ["text", ...languages],
							preferredHighlighter: this.preferredHighlighter
						}), this.initializeWorkers(resolvedThemes, resolvedLanguages)]);
						if (!this.isCurrentLifecycle(lifecycleGeneration)) {
							this.terminateWorkers();
							resolve();
							return;
						}
						this.highlighter = highlighter;
						this.initialized = true;
						this.diffCache.clear();
						this.fileCache.clear();
						this.drainQueue();
						this.queueBroadcastStateChanges();
						resolve();
					} catch (e) {
						if (e instanceof WorkerPoolTerminatedError || !this.isCurrentLifecycle(lifecycleGeneration)) {
							resolve();
							return;
						}
						this.initialized = false;
						this.workersFailed = true;
						this.queueBroadcastStateChanges();
						reject(e);
					}
				})();
			});
			this.queueBroadcastStateChanges();
		} else return this.initialized;
	}
	async initializeWorkers(resolvedThemes, resolvedLanguages) {
		this.workersFailed = false;
		const initPromises = [];
		const customExtensionVersion = getCustomExtensionsVersion();
		const customExtensionMap = customExtensionVersion > 0 ? getCustomExtensionsMap() : void 0;
		if (this.workers.length > 0) this.terminateWorkers();
		for (let i = 0; i < (this.options.poolSize ?? 8); i++) {
			const worker = this.options.workerFactory();
			const managedWorker = {
				worker,
				requestId: void 0,
				pendingSetupRequestId: void 0,
				initialized: false,
				langs: /* @__PURE__ */ new Set(["text", ...resolvedLanguages.map(({ name }) => name)]),
				customExtensionsVersion: 0
			};
			worker.addEventListener("message", (event) => {
				this.handleWorkerMessage(managedWorker, event.data);
			});
			worker.addEventListener("error", (error) => console.error("Worker error:", error, managedWorker));
			this.workers.push(managedWorker);
			initPromises.push(new Promise((resolve, reject) => {
				const id = this.generateRequestId();
				const task = {
					type: "initialize",
					id,
					request: {
						type: "initialize",
						id,
						renderOptions: this.renderOptions,
						preferredHighlighter: this.preferredHighlighter,
						resolvedThemes,
						resolvedLanguages,
						customExtensionsVersion: customExtensionMap != null ? customExtensionVersion : void 0,
						customExtensionMap
					},
					resolve() {
						managedWorker.initialized = true;
						resolve();
					},
					reject,
					requestStart: Date.now()
				};
				this.activeTaskById.set(id, task);
				this.executeTask(managedWorker, task);
			}));
		}
		await Promise.all(initPromises);
	}
	drainQueue = () => {
		this._queuedDrain = void 0;
		if (this.initialized !== true || this.queuedTasks.length === 0) return;
		for (let i = 0; i < this.queuedTasks.length;) {
			const task = this.queuedTasks[i];
			if (this.hasActiveRequest(task)) {
				i++;
				continue;
			}
			const langs = getLangsFromTask(task);
			const availableWorker = this.getAvailableWorker(langs);
			if (availableWorker == null) break;
			this.queuedTasks.splice(i, 1);
			this.assignWorkerToTask(task, availableWorker);
			this.resolveLanguagesAndExecuteTask(availableWorker, task, langs);
		}
		this.queueBroadcastStateChanges();
	};
	highlightFileAST(instance, file) {
		const cachedResult = this.getFileResultCache(file);
		if (isFilePlainText(file) || cachedResult != null && areFileRenderOptionsEqual(cachedResult.options, this.getFileRenderOptions())) return;
		if (!this.hasMatchingFileInstanceTask(instance, file)) this.submitTask(instance, {
			type: "file",
			file
		});
	}
	primeFileHighlightCache(file) {
		if (file.cacheKey == null) {
			console.warn(`WorkerPoolManager.primeFileHighlightCache: priming highlight cache requires file.cacheKey; skipping "${file.name}".`);
			return;
		}
		const cachedResult = this.getFileResultCache(file);
		const highlightKey = this.getFileHighlightKey(file);
		if (highlightKey == null || isFilePlainText(file) || cachedResult != null && areFileRenderOptionsEqual(cachedResult.options, this.getFileRenderOptions())) return;
		const existingTask = this.getTaskByHighlightKey(highlightKey);
		if (existingTask != null) existingTask.primeCache = true;
		else this.submitCacheTask({
			type: "file",
			file
		}, highlightKey);
	}
	getPlainFileAST(file, startingLine, totalLines, lines) {
		if (this.highlighter == null) {
			this.queueInitialization();
			return;
		}
		return renderFileWithHighlighter(file, this.highlighter, this.renderOptions, {
			forcePlainText: true,
			startingLine,
			totalLines,
			lines
		});
	}
	highlightDiffAST(instance, diff) {
		const cachedResult = this.getDiffResultCache(diff);
		if (isDiffPlainText(diff) || cachedResult != null && areDiffRenderOptionsEqual(cachedResult.options, this.getDiffRenderOptions())) return;
		if (!this.hasMatchingDiffInstanceTask(instance, diff)) this.submitTask(instance, {
			type: "diff",
			diff
		});
	}
	primeDiffHighlightCache(diff) {
		if (diff.cacheKey == null) {
			console.warn(`WorkerPoolManager.primeDiffHighlightCache: priming highlight cache requires diff.cacheKey; skipping "${diff.prevName ?? diff.name}" -> "${diff.name}".`);
			return;
		}
		const cachedResult = this.getDiffResultCache(diff);
		const highlightKey = this.getDiffHighlightKey(diff);
		if (highlightKey == null || isDiffPlainText(diff) || cachedResult != null && areDiffRenderOptionsEqual(cachedResult.options, this.getDiffRenderOptions())) return;
		const existingTask = this.getTaskByHighlightKey(highlightKey);
		if (existingTask != null) existingTask.primeCache = true;
		else this.submitCacheTask({
			type: "diff",
			diff
		}, highlightKey);
	}
	getPlainDiffAST(diff, startingLine, totalLines, expandedHunks, collapsedContextThreshold) {
		return this.highlighter != null ? renderDiffWithHighlighter(diff, this.highlighter, this.renderOptions, {
			forcePlainText: true,
			startingLine,
			totalLines,
			expandedHunks,
			collapsedContextThreshold
		}) : void 0;
	}
	terminate() {
		this.lifecycleGeneration++;
		this.cancelActiveWorkerTasks();
		this.terminateWorkers();
		this.fileCache.clear();
		this.diffCache.clear();
		this.activeRequestByInstance.clear();
		this.queuedTasks.length = 0;
		this.queuedTaskByInstance.clear();
		this.taskByHighlightKey.clear();
		this.activeTaskById.clear();
		this.highlighter = void 0;
		this.initialized = false;
		this.workersFailed = false;
		this.queueBroadcastStateChanges();
	}
	isCurrentLifecycle(lifecycleGeneration) {
		return this.lifecycleGeneration === lifecycleGeneration;
	}
	queueInitialization(languages) {
		this.initialize(languages).catch((error) => {
			console.error(error);
		});
	}
	cancelActiveWorkerTasks() {
		const error = new WorkerPoolTerminatedError();
		for (const task of this.activeTaskById.values()) if ("reject" in task) task.reject(error);
	}
	terminateWorkers() {
		for (const managedWorker of this.workers) managedWorker.worker.terminate();
		this.workers.length = 0;
	}
	getStats() {
		return {
			managerState: (() => {
				if (this.initialized === false) return "waiting";
				if (this.initialized !== true) return "initializing";
				return "initialized";
			})(),
			totalWorkers: this.workers.length,
			workersFailed: this.workersFailed,
			busyWorkers: this.workers.filter((w) => w.requestId != null || w.pendingSetupRequestId != null).length,
			queuedTasks: this.queuedTasks.length,
			activeTasks: this.activeTaskById.size,
			themeSubscribers: this.themeSubscribers.size,
			fileCacheSize: this.fileCache.size,
			diffCacheSize: this.diffCache.size
		};
	}
	submitTask(instance, request) {
		if (this.initialized === false) this.queueInitialization();
		const highlightKey = this.getHighlightKeyForRequest(request);
		const existingTask = highlightKey != null ? this.getTaskByHighlightKey(highlightKey) : void 0;
		if (existingTask != null) {
			this.detachInstanceFromQueuedTasks(instance, existingTask);
			this.addInstanceToTask(existingTask, instance);
			this.queueBroadcastStateChanges();
			return;
		}
		this.detachInstanceFromQueuedTasks(instance);
		const id = this.generateRequestId();
		const requestStart = Date.now();
		const { renderOptionsVersion } = this;
		const task = (() => {
			switch (request.type) {
				case "file": return {
					type: "file",
					id,
					request: {
						...request,
						id
					},
					instances: /* @__PURE__ */ new Set([instance]),
					primeCache: false,
					highlightKey,
					renderOptionsVersion,
					requestStart
				};
				case "diff": return {
					type: "diff",
					id,
					request: {
						...request,
						id
					},
					instances: /* @__PURE__ */ new Set([instance]),
					primeCache: false,
					highlightKey,
					renderOptionsVersion,
					requestStart
				};
			}
		})();
		this.enqueueRenderTask(task, instance);
	}
	submitCacheTask(request, highlightKey) {
		if (this.initialized === false) this.queueInitialization();
		const id = this.generateRequestId();
		const requestStart = Date.now();
		const { renderOptionsVersion } = this;
		const task = (() => {
			switch (request.type) {
				case "file": return {
					type: "file",
					id,
					request: {
						...request,
						id
					},
					instances: /* @__PURE__ */ new Set(),
					primeCache: true,
					highlightKey,
					renderOptionsVersion,
					requestStart
				};
				case "diff": return {
					type: "diff",
					id,
					request: {
						...request,
						id
					},
					instances: /* @__PURE__ */ new Set(),
					primeCache: true,
					highlightKey,
					renderOptionsVersion,
					requestStart
				};
			}
		})();
		this.enqueueRenderTask(task);
	}
	enqueueRenderTask(task, instance) {
		this.queuedTasks.push(task);
		if (instance != null) this.queuedTaskByInstance.set(instance, task);
		if (task.highlightKey != null) this.taskByHighlightKey.set(task.highlightKey, task);
		this.queueDrain();
	}
	async resolveLanguagesAndExecuteTask(availableWorker, task, langs) {
		try {
			const workerMissingLangs = langs.filter((lang) => !availableWorker.langs.has(lang));
			if (workerMissingLangs.length > 0) if (hasResolvedLanguages(workerMissingLangs)) task.request.resolvedLanguages = getResolvedLanguages(workerMissingLangs);
			else task.request.resolvedLanguages = await resolveLanguages(workerMissingLangs);
			if (!this.activeTaskById.has(task.id)) {
				if (availableWorker.requestId === task.id) {
					this.cleanWorkerAndTask(availableWorker, task);
					this.queueBroadcastStateChanges();
					if (this.queuedTasks.length > 0) this.queueDrain();
				}
				return;
			}
			this.executeTask(availableWorker, task);
		} catch {
			this.cleanWorkerAndTask(availableWorker, task);
			this.queueBroadcastStateChanges();
			if (this.queuedTasks.length > 0) this.queueDrain();
		}
	}
	handleWorkerMessage(managedWorker, response) {
		const task = this.activeTaskById.get(response.id);
		try {
			if (task == null) throw IGNORE_RESPONSE;
			else if (response.type === "error") {
				const error = new Error(response.error);
				if (response.stack) error.stack = response.stack;
				if ("reject" in task) task.reject(error);
				else if (isRenderTask(task)) this.notifyHighlightError(task, error);
				else throw new Error("handleWorkerMessage: unknown task type");
				throw error;
			} else switch (response.requestType) {
				case "initialize":
					if (task.type !== "initialize") throw new Error("handleWorkerMessage: task/response dont match");
					this.syncCustomExtensionVersion(managedWorker, task.request);
					task.resolve();
					break;
				case "set-render-options":
					if (task.type !== "set-render-options") throw new Error("handleWorkerMessage: task/response dont match");
					task.resolve();
					break;
				case "file": {
					if (task.type !== "file") throw new Error("handleWorkerMessage: task/response dont match");
					const { result, options } = response;
					if (!this.isCurrentRenderTask(task) || !areFileRenderOptionsEqual(options, this.getFileRenderOptions())) throw IGNORE_RESPONSE;
					const { request } = task;
					this.syncCustomExtensionVersion(managedWorker, request);
					if (request.file.cacheKey != null) this.fileCache.set(request.file.cacheKey, {
						result,
						options
					});
					this.notifyFileInstances(task, result, options);
					break;
				}
				case "diff": {
					if (task.type !== "diff") throw new Error("handleWorkerMessage: task/response dont match");
					const { result, options } = response;
					if (!this.isCurrentRenderTask(task) || !areDiffRenderOptionsEqual(options, this.getDiffRenderOptions())) throw IGNORE_RESPONSE;
					const { request } = task;
					this.syncCustomExtensionVersion(managedWorker, request);
					if (request.diff.cacheKey != null) this.diffCache.set(request.diff.cacheKey, {
						result,
						options
					});
					this.notifyDiffInstances(task, result, options);
					break;
				}
			}
		} catch (error) {
			if (error !== IGNORE_RESPONSE) console.error(error, task, response);
		}
		this.cleanWorkerAndTask(managedWorker, task, response.id);
		this.queueBroadcastStateChanges();
		if (this.queuedTasks.length > 0) this.queueDrain();
	}
	_queuedDrain;
	queueDrain() {
		if (this._queuedDrain != null) return;
		this._queuedDrain = Promise.resolve().then(this.drainQueue);
		this.queueBroadcastStateChanges();
	}
	assignWorkerToTask(task, managedWorker) {
		managedWorker.requestId = task.id;
		if (isRenderTask(task)) {
			this.clearQueuedInstanceRequests(task);
			this.trackInstanceRequests(task);
		}
		this.activeTaskById.set(task.id, task);
	}
	cleanWorkerAndTask(managedWorker, task, requestId = task?.id) {
		if (managedWorker.requestId === requestId) managedWorker.requestId = void 0;
		if (managedWorker.pendingSetupRequestId === requestId) managedWorker.pendingSetupRequestId = void 0;
		if (task != null) {
			if (isRenderTask(task)) {
				this.clearInstanceRequests(task);
				this.clearHighlightKey(task);
			}
			this.activeTaskById.delete(task.id);
		}
	}
	executeTask(managedWorker, task) {
		if (shouldSyncCustomExtensions(task.request)) this.maybeAttachCustomExtensions(managedWorker, task.request);
		if (!this.activeTaskById.has(task.id)) this.assignWorkerToTask(task, managedWorker);
		for (const lang of getLangsFromTask(task)) managedWorker.langs.add(lang);
		try {
			managedWorker.worker.postMessage(task.request);
		} catch (error) {
			console.error("Failed to post message to worker:", error);
			if (isRenderTask(task)) this.notifyHighlightError(task, error);
			else if ("reject" in task) task.reject(error);
			this.cleanWorkerAndTask(managedWorker, task);
			if (this.queuedTasks.length > 0) this.queueDrain();
		}
		this.queueBroadcastStateChanges();
	}
	maybeAttachCustomExtensions(managedWorker, request) {
		if (request.customExtensionsVersion != null) return;
		const version = getCustomExtensionsVersion();
		if (managedWorker.customExtensionsVersion >= version) return;
		request.customExtensionsVersion = version;
		request.customExtensionMap = getCustomExtensionsMap();
	}
	syncCustomExtensionVersion(managedWorker, request) {
		if (request.customExtensionsVersion == null) return;
		managedWorker.customExtensionsVersion = request.customExtensionsVersion;
	}
	getAvailableWorker(langs) {
		let worker;
		for (const managedWorker of this.workers) {
			if (managedWorker.requestId != null || managedWorker.pendingSetupRequestId != null || !managedWorker.initialized) continue;
			worker = managedWorker;
			if (langs.length === 0) break;
			let hasEveryLang = true;
			for (const lang of langs) if (!managedWorker.langs.has(lang)) {
				hasEveryLang = false;
				break;
			}
			if (hasEveryLang) break;
		}
		return worker;
	}
	getFileHighlightKey(file) {
		if (file.cacheKey == null) return;
		return `file:${file.cacheKey}:${this.renderOptionsVersion}`;
	}
	getDiffHighlightKey(diff) {
		if (diff.cacheKey == null) return;
		return `diff:${diff.cacheKey}:${this.renderOptionsVersion}`;
	}
	getHighlightKeyForRequest(request) {
		switch (request.type) {
			case "file": return this.getFileHighlightKey(request.file);
			case "diff": return this.getDiffHighlightKey(request.diff);
		}
	}
	hasActiveRequest(task) {
		for (const instance of getInstances(task)) if (this.activeRequestByInstance.has(instance)) return true;
		return false;
	}
	addInstanceToTask(task, instance) {
		if (task.type === "file") task.instances.add(instance);
		else task.instances.add(instance);
		if (this.activeTaskById.has(task.id)) this.activeRequestByInstance.set(instance, task.id);
		else this.queuedTaskByInstance.set(instance, task);
	}
	detachInstanceFromQueuedTasks(instance, exceptTask) {
		const task = this.queuedTaskByInstance.get(instance);
		if (task == null || task === exceptTask) return;
		this.queuedTaskByInstance.delete(instance);
		this.detachInstanceFromRenderTask(task, instance);
		if (!task.primeCache && task.instances.size === 0) this.removeQueuedTask(task);
	}
	detachInstanceFromRenderTask(task, instance) {
		if (task.type === "file") task.instances.delete(instance);
		else task.instances.delete(instance);
	}
	removeQueuedTask(task) {
		const index = this.queuedTasks.indexOf(task);
		if (index !== -1) this.queuedTasks.splice(index, 1);
		this.clearQueuedInstanceRequests(task);
		this.clearHighlightKey(task);
	}
	removeActiveTask(task) {
		this.clearInstanceRequests(task);
		this.clearHighlightKey(task);
		this.activeTaskById.delete(task.id);
	}
	invalidateRenderTasks() {
		for (let index = this.queuedTasks.length - 1; index >= 0; index--) {
			const task = this.queuedTasks[index];
			if (task.renderOptionsVersion !== this.renderOptionsVersion) this.removeQueuedTask(task);
		}
		for (const task of Array.from(this.activeTaskById.values())) if (isRenderTask(task) && task.renderOptionsVersion !== this.renderOptionsVersion) this.removeActiveTask(task);
	}
	clearQueuedInstanceRequests(task) {
		for (const instance of getInstances(task)) if (this.queuedTaskByInstance.get(instance) === task) this.queuedTaskByInstance.delete(instance);
	}
	clearHighlightKey(task) {
		if (task.highlightKey != null && this.taskByHighlightKey.get(task.highlightKey) === task) this.taskByHighlightKey.delete(task.highlightKey);
	}
	trackInstanceRequests(task) {
		for (const instance of getInstances(task)) this.activeRequestByInstance.set(instance, task.id);
	}
	clearInstanceRequests(task) {
		for (const instance of getInstances(task)) if (this.activeRequestByInstance.get(instance) === task.id) this.activeRequestByInstance.delete(instance);
	}
	notifyFileInstances(task, result, options) {
		for (const instance of task.instances) if (this.activeRequestByInstance.get(instance) === task.id) instance.onHighlightSuccess(task.request.file, result, options);
	}
	notifyDiffInstances(task, result, options) {
		for (const instance of task.instances) if (this.activeRequestByInstance.get(instance) === task.id) instance.onHighlightSuccess(task.request.diff, result, options);
	}
	notifyHighlightError(task, error) {
		for (const instance of getInstances(task)) if (this.activeRequestByInstance.get(instance) === task.id) instance.onHighlightError(error);
	}
	hasMatchingFileInstanceTask(instance, file) {
		for (const task of this.iterateRenderTasks()) if (task.type === "file" && this.isCurrentRenderTask(task) && task.instances.has(instance) && areFilesEqual(file, task.request.file)) return true;
		return false;
	}
	hasMatchingDiffInstanceTask(instance, diff) {
		for (const task of this.iterateRenderTasks()) if (task.type === "diff" && this.isCurrentRenderTask(task) && task.instances.has(instance) && areDiffTargetsEqual(task.request.diff, diff)) return true;
		return false;
	}
	getTaskByHighlightKey(highlightKey) {
		const task = this.taskByHighlightKey.get(highlightKey);
		return task != null && this.isCurrentRenderTask(task) ? task : void 0;
	}
	isCurrentRenderTask(task) {
		return task.renderOptionsVersion === this.renderOptionsVersion;
	}
	*iterateRenderTasks() {
		for (const task of this.queuedTasks) yield task;
		for (const task of this.activeTaskById.values()) if (isRenderTask(task)) yield task;
	}
	generateRequestId() {
		return `req_${++this.nextRequestId}`;
	}
};
function shouldSyncCustomExtensions(request) {
	return request.type === "initialize" || request.type === "file" || request.type === "diff";
}
function getLangsFromTask(task) {
	const langs = /* @__PURE__ */ new Set();
	if (task.type === "initialize" || task.type === "set-render-options") return [];
	switch (task.type) {
		case "file":
			langs.add(task.request.file.lang ?? getFiletypeFromFileName(task.request.file.name));
			break;
		case "diff":
			langs.add(task.request.diff.lang ?? getFiletypeFromFileName(task.request.diff.name));
			langs.add(task.request.diff.lang ?? getFiletypeFromFileName(task.request.diff.prevName ?? "-"));
			break;
	}
	langs.delete("text");
	return Array.from(langs);
}
function isRenderTask(task) {
	return task?.type === "file" || task?.type === "diff";
}
function getInstances(task) {
	return task.instances;
}
//#endregion
export { WorkerPoolManager };

//# sourceMappingURL=WorkerPoolManager.js.map
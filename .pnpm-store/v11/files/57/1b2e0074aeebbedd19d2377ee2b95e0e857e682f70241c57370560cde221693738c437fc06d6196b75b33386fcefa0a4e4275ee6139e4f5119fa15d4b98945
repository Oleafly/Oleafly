import { WorkerPoolManager } from "./WorkerPoolManager.js";
//#region src/worker/getOrCreateWorkerPoolSingleton.ts
let workerPoolSingleton;
function getOrCreateWorkerPoolSingleton({ poolOptions, highlighterOptions }) {
	workerPoolSingleton ??= new WorkerPoolManager(poolOptions, highlighterOptions);
	return workerPoolSingleton;
}
function terminateWorkerPoolSingleton() {
	if (workerPoolSingleton == null) return;
	workerPoolSingleton.terminate();
	workerPoolSingleton = void 0;
}
//#endregion
export { getOrCreateWorkerPoolSingleton, terminateWorkerPoolSingleton };

//# sourceMappingURL=getOrCreateWorkerPoolSingleton.js.map
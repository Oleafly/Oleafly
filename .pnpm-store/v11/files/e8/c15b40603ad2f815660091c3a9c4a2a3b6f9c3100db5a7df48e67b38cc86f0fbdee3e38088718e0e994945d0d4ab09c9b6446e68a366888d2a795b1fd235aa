import { WorkerInitializationRenderOptions, WorkerPoolOptions } from "../worker/types.js";
import { WorkerPoolManager } from "../worker/WorkerPoolManager.js";
import { SetupWorkerPoolProps } from "../worker/getOrCreateWorkerPoolSingleton.js";
import { Context, ReactNode } from "react";

//#region src/react/WorkerPoolContext.d.ts
declare const WorkerPoolContext: Context<WorkerPoolManager | undefined>;
interface WorkerPoolContextProps extends SetupWorkerPoolProps {
  children: ReactNode;
}
declare function WorkerPoolContextProvider({
  children,
  poolOptions,
  highlighterOptions
}: WorkerPoolContextProps): React.JSX.Element;
declare function useWorkerPool(): WorkerPoolManager | undefined;
//#endregion
export { type WorkerInitializationRenderOptions, WorkerPoolContext, WorkerPoolContextProvider, type WorkerPoolOptions, useWorkerPool };
//# sourceMappingURL=WorkerPoolContext.d.ts.map
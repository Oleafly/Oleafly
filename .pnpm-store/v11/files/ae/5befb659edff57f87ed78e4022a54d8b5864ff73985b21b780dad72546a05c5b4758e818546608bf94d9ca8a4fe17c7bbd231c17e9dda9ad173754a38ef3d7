import type { InternalNamePath, WatchCallBack } from '../interface';
import type { FormStore } from './useForm';
/**
 * Call action with delay in macro task.
 */
export declare const macroTask: (fn: VoidFunction) => void;
export default class WatcherCenter {
    namePathList: InternalNamePath[];
    taskId: number;
    watcherList: Set<WatchCallBack>;
    form: FormStore;
    constructor(form: FormStore);
    register(callback: WatchCallBack): VoidFunction;
    notify(namePath: InternalNamePath[]): void;
    private doBatch;
}

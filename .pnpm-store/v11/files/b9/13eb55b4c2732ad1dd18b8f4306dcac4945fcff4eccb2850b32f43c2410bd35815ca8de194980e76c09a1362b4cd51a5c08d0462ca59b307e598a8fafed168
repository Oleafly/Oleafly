import { log } from './util/logger';
/**
 * @internal
 * Build Record<string, any> object to be injected when creates runtime for asm module.
 * Modularized asm module generated via MODULARIZE=1 accepts object as its creation function allow to attach
 * properties. Using those, this function construct few essential convinient functions like awaitable runtime init.
 *
 * Note some init like exporting in-memory FS functions can't be achieved via module object but should rely on
 * preprocessor (https://github.com/kwonoj/docker-hunspell-wasm/blob/eba7781311b31028eefb8eb3e2457d11f294e076/preprocessor.js#L14-L27)
 * to access function-scope variables inside.
 *
 * @param {Record<string, any>} value pre-constructed value to be used, or empty object {}.
 * @param {string} [binaryEndpoint] Provides endpoint to server to download binary module.
 * This value is for browser only - on node.js, should rely on emscripten's default resolution.
 *
 * @returns {Record<string, any>} Augmented object with prefilled interfaces.
 */
const constructModule = (value, binaryRemoteEndpoint) => {
    const ret = {
        ...value,
        __asm_module_isInitialized__: false,
        onRuntimeInitialized: null,
        initializeRuntime: null
    };
    if (!!binaryRemoteEndpoint) {
        log(`constructModule: binaryRemoteEndpoint found, override locateFile function`);
        ret.locateFile = (fileName) => `${binaryRemoteEndpoint}/${fileName}`;
    }
    //export initializeRuntime interface for awaitable runtime initialization
    ret.initializeRuntime = (timeout = 3000) => {
        if (ret.__asm_module_isInitialized__) {
            return Promise.resolve(true);
        }
        return new Promise((resolve, _reject) => {
            const timeoutId = setTimeout(() => resolve(false), timeout);
            //trap out preamble `abort()` function to avoid too verbose exception details
            //but only for initialization phase. Other errors will be thrown by postamble.js.
            ret.onAbort = (reason) => {
                if (!ret.__asm_module_isInitialized__) {
                    clearTimeout(timeoutId);
                    log(`initializeRuntime: failed to initialize module`, reason);
                    throw reason instanceof Error ? reason : new Error(reason);
                }
            };
            ret.onRuntimeInitialized = () => {
                clearTimeout(timeoutId);
                ret.__asm_module_isInitialized__ = true;
                log(`initializeRuntime: successfully initialized module`);
                resolve(true);
            };
        });
    };
    return ret;
};
export { constructModule };
//# sourceMappingURL=constructModule.js.map
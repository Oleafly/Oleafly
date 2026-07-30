import { constructModule } from './constructModule';
import { log } from './util/logger';
/**
 * Creates loader function to load and initialize wasm module.
 *
 * @param {(runtime: R) => T} factoryLoader Factory to create actual instance of implementation using loaded & initialized wasm runtime.
 *
 * @param {runtimeModuleType} runtimeModule Actual runtime to initialize.
 * It is wasm runtime loaded via plain `require` but compiled with MODULARIZED=1 preamble with SINGLE_FILE option
 * which should be function to accept asm module object to override.
 *
 * @param {Record<string, any>} [module] Record<string, any> object to be injected into wasm runtime for override/set additional value in asm module.
 *
 * @param {ModuleInitOption} [initOptions] Configuration used to initialize the module
 *
 * @returns {moduleLoaderType<T>} Loader function
 */
const getModuleLoader = (factoryLoader, runtimeModule, module, { timeout, binaryRemoteEndpoint } = {}) => async () => {
    const constructedModule = constructModule(module || {}, binaryRemoteEndpoint);
    log(`loadModule: constructed module object for runtime`);
    try {
        const asmModule = runtimeModule(constructedModule);
        const result = await asmModule.initializeRuntime(timeout);
        if (!result) {
            log(`loadModule: failed to initialize runtime in time`);
            throw new Error(`Timeout to initialize runtime`);
        }
        log(`loadModule: initialized wasm binary Runtime`);
        return factoryLoader(asmModule);
    }
    catch (e) {
        log(`loadModule: failed to initialize wasm binary runtime`);
        throw e;
    }
};
export { getModuleLoader };
//# sourceMappingURL=getModuleLoader.js.map
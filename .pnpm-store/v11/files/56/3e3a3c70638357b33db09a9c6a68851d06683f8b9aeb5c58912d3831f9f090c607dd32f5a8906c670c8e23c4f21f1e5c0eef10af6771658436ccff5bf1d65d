import { AsmRuntimeType, constructModule } from './constructModule';
import { log } from './util/logger';

/**
 * Asynchronously load and initialize asm module.
 *
 * @returns {T} Factory function manages lifecycle of hunspell and virtual files.
 */
type moduleLoaderType<T> = () => Promise<T>;

/**
 * Initialization options given to `getModuleLoader`
 */
interface ModuleInitOption {
  binaryRemoteEndpoint: string;
  timeout: number;
}

/**
 * Type of runtime module function. This is node.js asm module loaded via plain `require`,
 * internally emscripten should compile with MODULARIZE=1 option to loaded module via require returns
 * function to construct wasm module internally.
 *
 * For example,
 * ```
 * const asmLoader: runtimeModuleType = require('./lib/wasm/hunspell')
 * asmLoader(); //actually construct wasm module
 * ```
 */
type runtimeModuleType = (moduleObject: Record<string, any>) => AsmRuntimeType;

type getModuleLoaderType = <T, R extends AsmRuntimeType>(
  factoryLoader: (runtime: R) => T,
  runtimeModule: runtimeModuleType,
  module?: Record<string, any>,
  moduleInitOption?: Partial<ModuleInitOption>
) => moduleLoaderType<T>;

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
const getModuleLoader: getModuleLoaderType = <T, R extends AsmRuntimeType>(
  factoryLoader: (runtime: R) => T,
  runtimeModule: runtimeModuleType,
  module?: Record<string, any>,
  { timeout, binaryRemoteEndpoint }: Partial<ModuleInitOption> = {}
) => async () => {
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

    return factoryLoader(asmModule as R) as T;
  } catch (e) {
    log(`loadModule: failed to initialize wasm binary runtime`);
    throw e;
  }
};

export { ModuleInitOption, runtimeModuleType, moduleLoaderType, getModuleLoaderType, getModuleLoader };

import { getModuleLoader } from 'emscripten-wasm-loader';
import { HunspellAsmModule } from './HunspellAsmModule';
import { HunspellFactory } from './HunspellFactory';
import { hunspellLoader } from './hunspellLoader';
import { log } from './util/logger';

//imports MODULARIZED emscripten preamble
import * as runtime from './lib/node/hunspell';

/**
 * Load, initialize wasm binary to use actual hunspell wasm instances.
 *
 * @param [InitOptions] Options to initialize hunspell wasm binary.
 * @param {number} [InitOptions.timeout] - timeout to wait wasm binary compilation & load.
 * @param {string | object} [InitOptions.locateBinary] - custom resolution logic for wasm binary. (not supported)
 * It could be either remote endpoint url, or loader-returned object for bundler. Check examples/browser_* for references.
 *
 * @returns {() => Promise<HunspellFactory>} Function to load module
 */
const loadModule = async (
  initOptions: Partial<{
    timeout: number;
  }> = {}
) => {
  const { timeout } = initOptions;
  log(`loadModule: loading hunspell wasm binary`, { initOptions });

  const moduleLoader = await getModuleLoader<HunspellFactory, HunspellAsmModule>(
    (runtime: HunspellAsmModule) => hunspellLoader(runtime),
    runtime,
    undefined,
    { timeout }
  );

  return moduleLoader();
};

export { loadModule };

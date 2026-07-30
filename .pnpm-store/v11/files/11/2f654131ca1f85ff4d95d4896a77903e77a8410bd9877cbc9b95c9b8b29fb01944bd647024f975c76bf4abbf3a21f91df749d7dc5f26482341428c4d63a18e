"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const emscripten_wasm_loader_1 = require("emscripten-wasm-loader");
const hunspellLoader_1 = require("./hunspellLoader");
const logger_1 = require("./util/logger");
//imports MODULARIZED emscripten preamble
const runtime = require("./lib/node/hunspell");
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
const loadModule = async (initOptions = {}) => {
    const { timeout } = initOptions;
    logger_1.log(`loadModule: loading hunspell wasm binary`, { initOptions });
    const moduleLoader = await emscripten_wasm_loader_1.getModuleLoader((runtime) => hunspellLoader_1.hunspellLoader(runtime), runtime, undefined, { timeout });
    return moduleLoader();
};
exports.loadModule = loadModule;
//# sourceMappingURL=loadModule.js.map
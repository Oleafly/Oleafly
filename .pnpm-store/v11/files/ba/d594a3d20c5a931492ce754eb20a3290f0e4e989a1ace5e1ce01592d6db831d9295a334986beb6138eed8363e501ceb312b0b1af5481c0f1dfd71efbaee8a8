import { HunspellFactory } from './HunspellFactory';
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
declare const loadModule: (initOptions?: Partial<{
    timeout: number;
}>) => Promise<HunspellFactory>;
export { loadModule };
//# sourceMappingURL=loadModule.d.ts.map
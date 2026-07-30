import { enableLogger as emscriptenEnableLogger } from 'emscripten-wasm-loader';
/**
 * Default log instance falls back to noop if not specified.
 */
let logInstance = () => {
    /* noop */
};
const log = (...args) => logInstance(...args);
/**
 * Enables logging internal behavior of hunspell-asm.
 * @param logger function to log.
 */
const enableLogger = (logger) => {
    const scopedLogger = (scope) => (message, ...optionalParams) => {
        logger(`${scope}::${message}`, ...optionalParams);
    };
    logInstance = scopedLogger(`hunspell`);
    emscriptenEnableLogger(scopedLogger(`hunspellLoader`));
};
export { enableLogger, log };
//# sourceMappingURL=logger.js.map
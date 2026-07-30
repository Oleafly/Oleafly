"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const emscripten_wasm_loader_1 = require("emscripten-wasm-loader");
/**
 * Default log instance falls back to noop if not specified.
 */
let logInstance = () => {
    /* noop */
};
const log = (...args) => logInstance(...args);
exports.log = log;
/**
 * Enables logging internal behavior of hunspell-asm.
 * @param logger function to log.
 */
const enableLogger = (logger) => {
    const scopedLogger = (scope) => (message, ...optionalParams) => {
        logger(`${scope}::${message}`, ...optionalParams);
    };
    logInstance = scopedLogger(`hunspell`);
    emscripten_wasm_loader_1.enableLogger(scopedLogger(`hunspellLoader`));
};
exports.enableLogger = enableLogger;
//# sourceMappingURL=logger.js.map
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
const enableLogger = (logger) => (logInstance = logger);
export { enableLogger, log };
//# sourceMappingURL=logger.js.map
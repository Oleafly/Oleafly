type logFunctionType = (message: string, ...optionalParams: Array<any>) => void;
/**
 * Default log instance falls back to noop if not specified.
 */
let logInstance: logFunctionType = () => {
  /* noop */
};

const log: logFunctionType = (...args: Array<any>) => (logInstance as any)(...args);

/**
 * Enables logging internal behavior of hunspell-asm.
 * @param logger function to log.
 */
const enableLogger = (logger: logFunctionType) => (logInstance = logger);

export { enableLogger, logFunctionType, log };

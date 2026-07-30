import { FS } from '../BaseAsmModule';
/**
 * Creates a function to mount phsyical path into wasm internal memory filesystem
 * to allow wasm can access phsyical file directly.
 *
 * @param {FS} FS wasm module filesystem
 * @param {string} nodePathId root path in memory filesystem to mount given path under.
 * This prefix path is generated automatically each time wasm module is loaded.
 *
 * @return {(dirPath: string) => string} function to mount given phsical path under memory filesystem.
 */
declare const mountDirectory: (FS: FS, nodePathId: string) => (dirPath: string) => string;
export { mountDirectory };
//# sourceMappingURL=mountDirectory.d.ts.map
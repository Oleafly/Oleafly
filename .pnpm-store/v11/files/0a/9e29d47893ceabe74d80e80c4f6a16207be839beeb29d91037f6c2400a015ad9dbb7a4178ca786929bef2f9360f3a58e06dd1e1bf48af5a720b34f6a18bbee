import { FS } from '../BaseAsmModule';
/**
 * Creates a function to mount contents of file into wasm internal memory filesystem
 * to allow wasm can access.
 *
 * @param {FS} FS wasm module filesystem
 * @param {string} memPathId root path in memory filesystem to mount given arrayBuffer.
 * This prefix path is generated automatically each time wasm module is loaded.
 *
 * @return {(contents: ArrayBufferView, fileName?: string) => string} function to mount buffer under memory filesystem.
 * If filename is not provided, it'll be generated automatically. This function checks existing file mounted via filename,
 * does not validate contents of buffer to find out already mounted one.
 */
declare const mountBuffer: (FS: FS, memPathId: string) => (contents: ArrayBufferView, fileName?: string | undefined) => string;
/**
 * Stub function to support `browser` field in package.json. Do not use.
 *
 * @internal
 */
declare const mountDirectory: () => never;
export { mountBuffer, mountDirectory };
//# sourceMappingURL=mountBuffer.d.ts.map
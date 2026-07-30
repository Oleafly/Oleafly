import { FS } from '../BaseAsmModule';
/**
 * Creates a function to unmount file or directory in wasm internal memory filesystem
 * If given mounted path prefix is pointing internal buffer file mounted via `mountBuffer`,
 * it'll be removed. Otherwise it'll be unmounted and remove internal directory.
 *
 * @param {FS} FS wasm module filesystem
 * @param {string} memPathId root path in memory filesystem to determine given unmount path is physical directory or buffer.
 * This prefix path is generated automatically each time wasm module is loaded.
 *
 * @return {(mountedPath: string) => void} function to unmount given path under memory filesystem.
 */
declare const unmount: (FS: FS, memPathId: string) => (mountedPath: string) => void;
export { unmount };
//# sourceMappingURL=unmount.d.ts.map
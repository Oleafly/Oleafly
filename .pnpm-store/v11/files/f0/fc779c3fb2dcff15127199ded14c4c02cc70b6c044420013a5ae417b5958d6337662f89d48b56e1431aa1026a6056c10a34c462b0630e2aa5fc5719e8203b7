"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../util/logger");
const isMounted_1 = require("./isMounted");
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
const unmount = (FS, memPathId) => (mountedPath) => {
    if (isMounted_1.isMounted(FS, mountedPath, 'file') && mountedPath.indexOf(memPathId) > -1) {
        logger_1.log(`unmount: ${mountedPath} is typedArrayFile, unlink from memory`);
        FS.unlink(mountedPath);
        return;
    }
    if (isMounted_1.isMounted(FS, mountedPath, 'dir')) {
        logger_1.log(`unmount: ${mountedPath} is directory, unmount`);
        FS.unmount(mountedPath);
        FS.rmdir(mountedPath);
        return;
    }
};
exports.unmount = unmount;
//# sourceMappingURL=unmount.js.map
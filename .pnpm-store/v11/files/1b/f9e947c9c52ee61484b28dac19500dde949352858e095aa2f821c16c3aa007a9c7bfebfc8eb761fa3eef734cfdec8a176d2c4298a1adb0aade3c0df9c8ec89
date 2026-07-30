"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../util/logger");
/**
 * Check if given mount path is already mounted
 *
 * @param {FS} FS wasm module filesystem
 * @param {string} mountPath path to wasm filesystem
 * @param {dir | file} type type of mountPath
 *
 * @returns {boolean} true if mounted, false otherwise or error occurred
 */
const isMounted = (FS, mountPath, type) => {
    try {
        const stat = FS.stat(mountPath);
        const typeFunction = type === 'dir' ? FS.isDir : FS.isFile;
        if (!!stat && typeFunction(stat.mode)) {
            logger_1.log(`isMounted: ${mountPath} is mounted`);
            return true;
        }
    }
    catch (e) {
        if (e.code !== 'ENOENT') {
            logger_1.log(`isMounted check failed`, e);
        }
    }
    return false;
};
exports.isMounted = isMounted;
//# sourceMappingURL=isMounted.js.map
import { log } from '../util/logger';
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
            log(`isMounted: ${mountPath} is mounted`);
            return true;
        }
    }
    catch (e) {
        if (e.code !== 'ENOENT') {
            log(`isMounted check failed`, e);
        }
    }
    return false;
};
export { isMounted };
//# sourceMappingURL=isMounted.js.map
import * as unixify from 'unixify';
import { isNode } from '../util/isNode';
import { log } from '../util/logger';
import { isMounted } from './isMounted';
import { mkdirTree } from './mkdirTree';
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
const mountDirectory = (FS, nodePathId) => (dirPath) => {
    if (!isNode()) {
        throw new Error('Mounting physical directory is not supported other than node.js environment');
    }
    const path = require('path'); //tslint:disable-line:no-require-imports
    const mountedDirPath = unixify(path.join(nodePathId, unixify(path.resolve(dirPath))));
    if (isMounted(FS, mountedDirPath, 'dir')) {
        log(`mountNodeFile: file is already mounted, return it`);
    }
    else {
        mkdirTree(FS, mountedDirPath);
        FS.mount(FS.filesystems.NODEFS, { root: path.resolve(dirPath) }, mountedDirPath);
    }
    return mountedDirPath;
};
export { mountDirectory };
//# sourceMappingURL=mountDirectory.js.map
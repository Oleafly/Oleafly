"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const unixify = require("unixify");
const isNode_1 = require("../util/isNode");
const logger_1 = require("../util/logger");
const isMounted_1 = require("./isMounted");
const mkdirTree_1 = require("./mkdirTree");
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
    if (!isNode_1.isNode()) {
        throw new Error('Mounting physical directory is not supported other than node.js environment');
    }
    const path = require('path'); //tslint:disable-line:no-require-imports
    const mountedDirPath = unixify(path.join(nodePathId, unixify(path.resolve(dirPath))));
    if (isMounted_1.isMounted(FS, mountedDirPath, 'dir')) {
        logger_1.log(`mountNodeFile: file is already mounted, return it`);
    }
    else {
        mkdirTree_1.mkdirTree(FS, mountedDirPath);
        FS.mount(FS.filesystems.NODEFS, { root: path.resolve(dirPath) }, mountedDirPath);
    }
    return mountedDirPath;
};
exports.mountDirectory = mountDirectory;
//# sourceMappingURL=mountDirectory.js.map
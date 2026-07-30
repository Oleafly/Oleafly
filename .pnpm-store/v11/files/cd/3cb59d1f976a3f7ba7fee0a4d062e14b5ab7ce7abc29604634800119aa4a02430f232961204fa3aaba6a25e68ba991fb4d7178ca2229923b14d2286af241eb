/**
 * `mkdir -p` implementation for wasm FS.mkdir interface.
 * dirPath param should be unixified.
 */
const mkdirTree = (FS, dirPath) => {
    const mkdir = (path) => {
        try {
            FS.mkdir(path);
        }
        catch (e) {
            //throw if not ERRNO_CODES.EEXIST
            if (e.errno != 17) {
                throw e;
            }
        }
    };
    dirPath
        .split('/')
        .filter(x => !!x)
        .reduce((acc, value) => {
        acc.push(`${acc.length > 0 ? acc[acc.length - 1] : ''}/${value}`);
        return acc;
    }, [])
        .forEach(mkdir);
};
export { mkdirTree };
//# sourceMappingURL=mkdirTree.js.map
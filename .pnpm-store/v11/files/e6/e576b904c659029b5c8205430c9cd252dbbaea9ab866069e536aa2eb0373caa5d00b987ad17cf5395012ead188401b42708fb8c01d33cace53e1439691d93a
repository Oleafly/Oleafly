"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getroot_1 = require("getroot");
/**
 * Naïvely detect if running environment if node
 * Note this'll return true on Electron's renderer process as well
 */
exports.isNode = () => {
    const proc = getroot_1.root.process;
    if (!!proc && typeof proc === 'object') {
        if (!!proc.versions && typeof proc.versions === 'object') {
            if (typeof proc.versions.node !== 'undefined') {
                return true;
            }
        }
    }
    return false;
};
//# sourceMappingURL=isNode.js.map
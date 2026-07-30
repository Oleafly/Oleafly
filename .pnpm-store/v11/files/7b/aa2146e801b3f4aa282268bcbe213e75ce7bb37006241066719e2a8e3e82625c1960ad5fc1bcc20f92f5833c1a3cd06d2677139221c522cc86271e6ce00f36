"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.warnItemProp = warnItemProp;
var _util = require("@rc-component/util");
/**
 * `onClick` event return `info.item` which point to react node directly.
 * We should warning this since it will not work on FC.
 */
function warnItemProp({
  item,
  ...restInfo
}) {
  Object.defineProperty(restInfo, 'item', {
    get: () => {
      (0, _util.warning)(false, '`info.item` is deprecated since we will move to function component that not provides React Node instance in future.');
      return item;
    }
  });
  return restInfo;
}